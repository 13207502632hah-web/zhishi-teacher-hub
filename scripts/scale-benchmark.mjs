#!/usr/bin/env node
// 可复现的题库规模基准：相似度两阶段候选、candidate payload、facets GROUP BY。
// 使用内存 SQLite，不会写入生产 D1。需要 Node 22.5+（node:sqlite）。

import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const tsModuleCache = new Map();
const requireTs = (absolutePath) => {
  if (tsModuleCache.has(absolutePath)) return tsModuleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  tsModuleCache.set(absolutePath, evaluatedModule);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
    return requireTs(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`);
  };
  new Function("module", "exports", "require", code)(evaluatedModule, evaluatedModule.exports, localRequire);
  return evaluatedModule.exports;
};
const loadTsModule = (path) => requireTs(fileURLToPath(new URL(`../${path}`, import.meta.url)));

const candidatesHelper = loadTsModule("app/lib/question-import-candidates.ts");
const { questionTextSimilarity } = loadTsModule("app/lib/question-similarity.ts");

const OLD_POOL_LIMIT = 2000;
const IMPORT_REFS = 300;

class CountingStatement {
  constructor(db, statementSql, onQuery) {
    this.db = db;
    this.sql = statementSql;
    this.onQuery = onQuery;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    this.onQuery(this.sql);
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  first() {
    this.onQuery(this.sql);
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
}

class CountingAdapter {
  constructor(db) {
    this.db = db;
    this.sqlCount = 0;
    this.statements = [];
  }

  prepare(statementSql) {
    return new CountingStatement(this.db, statementSql, (sql) => {
      this.sqlCount += 1;
      this.statements.push(sql);
    });
  }
}

const facetColumns = [
  "stage", "grade", "textbook_version", "volume", "unit", "topic",
  "knowledge_points", "question_type", "difficulty", "region", "exam_type", "year",
];

function createDatabase(questionCount) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stem TEXT NOT NULL,
      fingerprint TEXT,
      question_type TEXT,
      stage TEXT,
      grade TEXT,
      textbook_version TEXT,
      volume TEXT,
      unit TEXT,
      topic TEXT,
      knowledge_points TEXT,
      difficulty TEXT,
      region TEXT,
      exam_type TEXT,
      year TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  const insert = db.prepare(`
    INSERT INTO questions(
      stem, fingerprint, question_type, stage, grade, textbook_version, volume, unit,
      topic, knowledge_points, difficulty, region, exam_type, year, status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const pick = (values, index) => values[index % values.length];
  const types = ["单选题", "多选题", "材料题", "填空题", "解答题"];
  const stages = ["小学", "初中", "高中"];
  const grades = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"];
  const topics = ["函数", "几何", "概率", "方程", "统计", "数列"];
  const regions = ["北京", "上海", "江苏", "浙江", "广东", "四川"];
  const exams = ["期中", "期末", "月考", "中考", "高考"];
  for (let index = 0; index < questionCount; index++) {
    const seed = index === questionCount - 1
      ? "新题 0 近似题干变体"
      : index % 97 === 0 ? `${index} 变体题干` : `题干 ${index}`;
    const isProbeRow = index === questionCount - 1;
    insert.run(
      seed,
      `fp-${index}`,
      isProbeRow ? "单选题" : pick(types, index),
      isProbeRow ? "高中" : pick(stages, index),
      isProbeRow ? "高一" : pick(grades, index),
      `人教版`,
      pick(["上", "下"], index),
      pick(["第一单元", "第二单元", "第三单元"], index),
      pick(topics, index),
      `知识点${index % 20}`,
      pick(["易", "中", "难"], index),
      pick(regions, index),
      pick(exams, index),
      String(2019 + (index % 8)),
      "active",
    );
  }
  return db;
}

function buildImportRefs() {
  const refs = [];
  for (let index = 0; index < IMPORT_REFS; index++) {
    const stem = index % 11 === 0 ? `新题 ${index} 近似题干` : `新题 ${index}`;
    refs.push({
      stem,
      fingerprint: `new-fp-${index}`,
      questionType: "单选题",
      stage: "高中",
      grade: "高一",
      sourceQuestionNumber: index + 1,
    });
  }
  return candidatesHelper.buildSourceQuestionRefs(refs, (raw) => ({
    stem: String(raw.stem || ""),
    fingerprint: String(raw.fingerprint || ""),
    questionType: raw.questionType,
    stage: raw.stage,
    grade: raw.grade,
  }));
}

function oldSimilarityScan(refs, pool) {
  return refs.flatMap((ref) => pool
    .map((candidate) => ({
      sourceIndex: ref.sourceIndex,
      sourceQuestionNumber: ref.sourceQuestionNumber,
      sourceStem: ref.prepared.stem.slice(0, 180),
      candidateId: candidate.id,
      candidateStem: candidate.stem.slice(0, 180),
      similarity: questionTextSimilarity(ref.prepared.stem, candidate.stem),
      exact: candidate.fingerprint === ref.fingerprint,
    }))
    .filter((item) => !item.exact && item.similarity >= candidatesHelper.QUESTION_SIMILARITY_THRESHOLD)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, candidatesHelper.QUESTION_SIMILARITY_TOP));
}

async function benchmarkSimilarity(questionCount) {
  const db = createDatabase(questionCount);
  const refs = buildImportRefs();
  const results = { dataset: questionCount, before: null, after: null };

  const beforeAdapter = new CountingAdapter(db);
  const beforePool = await beforeAdapter.prepare(
    "SELECT id, stem, fingerprint FROM questions LIMIT ?",
  ).bind(OLD_POOL_LIMIT).all();
  const beforeStart = performance.now();
  const beforeRows = oldSimilarityScan(refs, beforePool.results);
  const beforeDuration = performance.now() - beforeStart;
  results.before = {
    sqlCount: beforeAdapter.sqlCount,
    candidateCount: beforePool.results.length,
    comparisonCount: refs.length * beforePool.results.length,
    durationMs: Number(beforeDuration.toFixed(2)),
    allIdsPayloadBytes: Buffer.byteLength(JSON.stringify(beforePool.results.map((row) => row.id))),
    topRows: beforeRows.length,
  };

  const afterAdapter = new CountingAdapter(db);
  const afterStart = performance.now();
  const { candidates, coverage } = await candidatesHelper.collectSimilarityCandidates(afterAdapter, refs);
  const afterRows = candidatesHelper.scanSimilarityCandidates(refs, candidates);
  const afterDuration = performance.now() - afterStart;
  results.after = {
    sqlCount: afterAdapter.sqlCount,
    candidateCount: candidates.length,
    comparisonCount: refs.length * candidates.length,
    durationMs: Number(afterDuration.toFixed(2)),
    allIdsPayloadBytes: Buffer.byteLength(JSON.stringify(candidates.map((candidate) => candidate.id))),
    topRows: afterRows.length,
    coverage,
  };

  db.close();
  return results;
}

async function benchmarkFacets(questionCount) {
  const db = createDatabase(questionCount);
  const queries = facetColumns.map((column) => ({
    column,
    run: () => db.prepare(
      `SELECT ${column} AS value, COUNT(*) AS count FROM questions WHERE status=? AND ${column} IS NOT NULL AND TRIM(CAST(${column} AS TEXT))!='' GROUP BY ${column} ORDER BY count DESC, ${column} LIMIT 300`,
    ).all("active"),
  }));
  const start = performance.now();
  await Promise.all(queries.map((query) => query.run()));
  const duration = performance.now() - start;
  const explain = db.prepare(
    "EXPLAIN QUERY PLAN SELECT stage AS value, COUNT(*) AS count FROM questions WHERE status=? AND stage IS NOT NULL AND TRIM(CAST(stage AS TEXT))!='' GROUP BY stage ORDER BY count DESC, stage LIMIT 300",
  ).all("active");
  const result = {
    dataset: questionCount,
    sqlCount: queries.length,
    durationMs: Number(duration.toFixed(2)),
    explain: explain.map((row) => `${row.detail || ""}`),
  };
  db.close();
  return result;
}

const datasets = [1000, 5000, 20000];
const similarity = [];
const facets = [];
for (const dataset of datasets) {
  similarity.push(await benchmarkSimilarity(dataset));
  facets.push(await benchmarkFacets(dataset));
}

const report = {
  generatedAt: new Date().toISOString(),
  constants: {
    oldPoolLimit: OLD_POOL_LIMIT,
    importRefs: IMPORT_REFS,
    similarityBudget: candidatesHelper.QUESTION_SIMILARITY_BUDGET,
    threshold: candidatesHelper.QUESTION_SIMILARITY_THRESHOLD,
    top: candidatesHelper.QUESTION_SIMILARITY_TOP,
  },
  similarity,
  facets,
};

mkdirSync("outputs", { recursive: true });
writeFileSync("outputs/scale-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);

console.log("=== 相似度候选基准 ===");
for (const row of similarity) {
  console.log(`${row.dataset} 题 before: sql=${row.before.sqlCount} candidates=${row.before.candidateCount} comparisons=${row.before.comparisonCount} duration=${row.before.durationMs}ms payload=${row.before.allIdsPayloadBytes}B top=${row.before.topRows}`);
  console.log(`${row.dataset} 题 after:  sql=${row.after.sqlCount} candidates=${row.after.candidateCount} comparisons=${row.after.comparisonCount} duration=${row.after.durationMs}ms payload=${row.after.allIdsPayloadBytes}B top=${row.after.topRows} coverage=${row.after.coverage.complete}`);
}
console.log("=== Facets 基准 ===");
for (const row of facets) {
  console.log(`${row.dataset} 题 sql=${row.sqlCount} duration=${row.durationMs}ms`);
}
console.log("报告已写入 outputs/scale-benchmark.json");
