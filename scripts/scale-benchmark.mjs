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

const EXACT_DUPLICATE = {
  type: "exact duplicate",
  ref: "基础题干 8 依法治国基本方略",
  duplicate: "基础题干 8 依法治国基本方略",
};

const DUPLICATE_GROUND_TRUTH = [
  EXACT_DUPLICATE,
  { type: "punctuation-only change", ref: "基础题干 0 材料分析", duplicate: "基础题干 0。材料分析！" },
  { type: "whitespace change", ref: "基础题干 1 坚持人民民主", duplicate: "基础题干 1 坚持  人民民主" },
  { type: "question-number change", ref: "基础题干 2 全过程人民民主三性统一", duplicate: "基础题干 2 全过程人民民主3性统一" },
  { type: "minor wording change", ref: "基础题干 3 人民代表大会制度是根本政治制度", duplicate: "基础题干 3 人民代表大会制度是我国根本政治制度" },
  { type: "moderate paraphrase", ref: "基础题干 4 人民通过选举组成国家权力机关", duplicate: "基础题干 4 人民通过选举组成国家权力机关行使权力" },
  { type: "deliberately hard duplicate", ref: "基础题干 5 全过程人民民主是最广泛最真实最管用的民主", duplicate: "基础题干 5 全过程人民民主是最广泛、最真实、最管用的社会主义民主" },
  { type: "option formatting/order change", ref: "基础题干 9 以下做法正确的是：A. 依法纳税 B. 依法服兵役 C. 依法受教育", duplicate: "基础题干 9 以下做法正确的是：B. 依法服兵役 A. 依法纳税 C. 依法受教育" },
  { type: "material/question relation (rephrased question)", ref: "材料：全过程人民民主把民主选举、民主协商、民主决策、民主管理、民主监督贯通起来，是全链条、全方位、全覆盖的民主。问题：为什么必须坚持全过程人民民主？", duplicate: "材料：全过程人民民主把民主选举、民主协商、民主决策、民主管理、民主监督贯通起来，是全链条、全方位、全覆盖的民主。问题：如何理解全过程人民民主的地位和作用？" },
  { type: "candidate-pool boundary (inside budget)", ref: "边界内 题干 10 近似变体甲", duplicate: "边界内 题干 10 近似变体甲 的表述" },
  { type: "candidate-pool boundary (outside budget)", ref: "边界外 题干 11 近似变体乙", duplicate: "边界外 题干 11 近似变体乙 的表述" },
  { type: "database-tail duplicate", ref: "库尾 题干 12 尾部分布副本", duplicate: "库尾 题干 12 尾部分布副本 补充表述" },
];

const DUPLICATE_NEGATIVES = [
  { type: "same material + different question", ref: "基础题干 6 关于依法治国下列说法正确的是", trap: "基础题干 6 关于依法治国下列说法错误的是" },
  { type: "different material + similar question", ref: "基础题干 7 坚持和发展中国特色社会主义", trap: "基础题干 7 坚持和发展中国特色市场经济" },
];

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

/**
 * 每个数据集都要放下全部 planted 行。跨区位置覆盖题库中部与尾部；
 * candidate-pool boundary 两行分别放在候选池最旧一行（0-based N-2000）和池外
 * 紧邻一行（0-based N-2001），用于验证预算边界是否诚实生效。N<=2000 时全部
 * 在预算内，越界位置统一映射到库内唯一位置。
 */
function groundTruthPositions(questionCount) {
  const n = questionCount;
  const boundaryInside = Math.max(0, n - OLD_POOL_LIMIT);
  const boundaryOutside = Math.max(0, n - OLD_POOL_LIMIT - 1);
  // 顺序与 DUPLICATE_GROUND_TRUTH + DUPLICATE_NEGATIVES 一一对应。
  // 大题库下，除 boundary outside 与两个较旧固定位置外，其余 planted 行都放进
  // 最新 2000 行的候选池内，保证每个规模的池内正确性证据充分；池外行用于证明
  // coverage=false 时不会假装全库检测。
  const raw = [
    n - 2,                // exact duplicate（库尾、候选池内）
    Math.floor(n * 0.12), // punctuation-only change（大题库下为池外旧行）
    Math.floor(n * 0.35), // whitespace change（大题库下为池外旧行）
    n - 1000,             // question-number change
    n - 500,              // option formatting/order change
    n - 250,              // minor wording change
    n - 120,              // moderate paraphrase
    n - 30,               // deliberately hard duplicate
    n - 10,               // material/question relation
    boundaryInside,     // candidate-pool boundary (inside budget)
    boundaryOutside,    // candidate-pool boundary (outside budget)
    n - 3,              // database-tail duplicate
    n - 40,             // negative: same material + different question
    n - 50,             // negative: different material + similar question
  ];
  const used = new Set();
  return raw.map((value) => {
    let position = Math.max(0, Math.min(n - 1, value));
    while (used.has(position)) {
      position = position > 0 ? position - 1 : n - 1;
    }
    used.add(position);
    return position;
  });
}

function createGroundTruthDatabase(questionCount) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stem TEXT NOT NULL,
      fingerprint TEXT,
      question_type TEXT,
      stage TEXT,
      grade TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  const insert = db.prepare(`
    INSERT INTO questions(stem, fingerprint, question_type, stage, grade, status)
    VALUES(?,?,?,?,?,?)
  `);
  const positions = groundTruthPositions(questionCount);
  const positives = DUPLICATE_GROUND_TRUTH.map((pair, index) => ({
    type: pair.type,
    refIndex: index,
    refStem: pair.ref,
    stem: pair.duplicate,
    fingerprint: `gt-fp-${index}`,
    position: positions[index],
    id: null,
  }));
  const negatives = DUPLICATE_NEGATIVES.map((pair, index) => ({
    type: pair.type,
    refIndex: positives.length + index,
    refStem: pair.ref,
    stem: pair.trap,
    fingerprint: `neg-fp-${index}`,
    position: positions[positives.length + index],
    id: null,
  }));
  const exact = positives[0];
  const plantedByPosition = new Map();
  for (const item of [...positives, ...negatives]) plantedByPosition.set(item.position, item);
  for (let index = 0; index < questionCount; index++) {
    const planted = plantedByPosition.get(index);
    if (planted) {
      insert.run(planted.stem, planted.fingerprint, "单选题", "高中", "高一", "active");
    } else {
      // 填充行与 planted 行共享宽条件，使候选池必须真实截断到预算上限，
      // 从而验证池边界与 coverage 语义。
      insert.run(`不相关题干 ${index}`, `base-fp-${index}`, "单选题", "高中", "高一", "active");
    }
  }
  const findId = (fingerprint) => Number(db.prepare("SELECT id FROM questions WHERE fingerprint=?").get(fingerprint)?.id || 0);
  for (const item of [...positives, ...negatives]) item.id = findId(item.fingerprint);
  return { db, positives, negatives, exact };
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

function buildGroundTruthRefs() {
  const raw = [
    ...DUPLICATE_GROUND_TRUTH.map((item) => ({ stem: item.ref })),
    ...DUPLICATE_NEGATIVES.map((item) => ({ stem: item.ref })),
  ];
  return candidatesHelper.buildSourceQuestionRefs(raw, (entry, index) => ({
    stem: String(entry.stem || ""),
    // 导入题 fingerprint 必须与库中既有题不同，扫描才会把库中 planted 行当作
    // 候选相似项而不是排除掉的同 fingerprint 精确重复。
    fingerprint: `ref-fp-${index}`,
    questionType: "单选题",
    stage: "高中",
    grade: "高一",
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

async function benchmarkDuplicateMetrics(questionCount) {
  const { db, positives, negatives, exact } = createGroundTruthDatabase(questionCount);
  const refs = buildGroundTruthRefs();
  const adapter = new CountingAdapter(db);
  const start = performance.now();
  const { candidates, coverage } = await candidatesHelper.collectSimilarityCandidates(adapter, refs);
  const rows = candidatesHelper.scanSimilarityCandidates(refs, candidates);
  const duration = performance.now() - start;

  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const truePositiveKeys = new Set(positives.map((pair) => `${pair.refIndex}:${pair.id}`));
  const truePositives = rows.filter((row) => truePositiveKeys.has(`${row.sourceIndex}:${row.candidateId}`));
  const falsePositives = rows.length - truePositives.length;
  const top1ById = new Map();
  const top3ById = new Map();
  for (const row of rows) {
    if (!top1ById.has(row.sourceIndex)) top1ById.set(row.sourceIndex, row.candidateId);
    if (!top3ById.has(row.sourceIndex)) top3ById.set(row.sourceIndex, new Set());
    top3ById.get(row.sourceIndex).add(row.candidateId);
  }
  const pairs = positives.map((pair) => ({
    type: pair.type,
    position: pair.position + 1,
    role: "positive",
    recalled: candidateIds.has(pair.id),
    top1: top1ById.get(pair.refIndex) === pair.id,
    top3: top3ById.get(pair.refIndex)?.has(pair.id) || false,
    similarityRows: rows.filter((row) => row.sourceIndex === pair.refIndex).length,
  }));
  const negativesReported = negatives.filter((pair) => rows.some((row) => row.sourceIndex === pair.refIndex && row.candidateId === pair.id)).length;
  const recalledCount = pairs.filter((pair) => pair.recalled).length;
  const inPoolPositiveCount = positives.filter((pair) => candidateIds.has(pair.id)).length;
  const exactDetected = candidateIds.has(exact.id);
  const pairsWithDetails = [...pairs, ...negatives.map((pair) => ({
    type: pair.type,
    position: pair.position + 1,
    role: "negative",
    recalled: candidateIds.has(pair.id),
    top1: top1ById.get(pair.refIndex) === pair.id,
    top3: top3ById.get(pair.refIndex)?.has(pair.id) || false,
    similarityRows: rows.filter((row) => row.sourceIndex === pair.refIndex).length,
  }))];

  const result = {
    dataset: questionCount,
    sqlCount: adapter.sqlCount,
    durationMs: Number(duration.toFixed(2)),
    comparisons: refs.length * candidates.length,
    coverage,
    positivePairs: positives.length,
    exactPairs: 1,
    inPoolPositiveCount,
    inPoolRecall: inPoolPositiveCount
      ? Number((pairs.filter((pair) => pair.recalled).length / inPoolPositiveCount).toFixed(4))
      : null,
    exactDetected,
    candidateRecall: Number((recalledCount / positives.length).toFixed(4)),
    top1Recall: Number((pairs.filter((pair) => pair.top1).length / positives.length).toFixed(4)),
    top3Recall: Number((pairs.filter((pair) => pair.top3).length / positives.length).toFixed(4)),
    falseNegatives: positives.length - recalledCount,
    reportedRows: rows.length,
    truePositives: truePositives.length,
    falsePositives,
    precision: rows.length ? Number((truePositives.length / rows.length).toFixed(4)) : null,
    negativesReported,
    pairs: pairsWithDetails,
  };
  db.close();
  return result;
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

const datasets = [1000, 5000, 20000, 50000];
const similarity = [];
const facets = [];
const duplicateMetrics = [];
for (const dataset of datasets) {
  similarity.push(await benchmarkSimilarity(dataset));
  facets.push(await benchmarkFacets(dataset));
  duplicateMetrics.push(await benchmarkDuplicateMetrics(dataset));
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
  duplicateMetrics,
};

mkdirSync("outputs", { recursive: true });
writeFileSync("outputs/scale-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);

console.log("=== 相似度候选基准 ===");
for (const row of similarity) {
  console.log(`${row.dataset} 题 before: sql=${row.before.sqlCount} candidates=${row.before.candidateCount} comparisons=${row.before.comparisonCount} duration=${row.before.durationMs}ms payload=${row.before.allIdsPayloadBytes}B top=${row.before.topRows}`);
  console.log(`${row.dataset} 题 after:  sql=${row.after.sqlCount} candidates=${row.after.candidateCount} comparisons=${row.after.comparisonCount} duration=${row.after.durationMs}ms payload=${row.after.allIdsPayloadBytes}B top=${row.after.topRows} coverage=${row.after.coverage.compared}/${row.after.coverage.total} complete=${row.after.coverage.complete}`);
}
console.log("=== Facets 基准 ===");
for (const row of facets) {
  console.log(`${row.dataset} 题 sql=${row.sqlCount} duration=${row.durationMs}ms`);
}
console.log("=== 重复检测指标 ===");
for (const row of duplicateMetrics) {
  console.log(`${row.dataset} 题 recall=${row.candidateRecall} inPool=${row.inPoolPositiveCount}/${row.positivePairs} inPoolRecall=${row.inPoolRecall} precision=${row.precision} top1=${row.top1Recall} top3=${row.top3Recall} exact=${row.exactDetected} fp=${row.falsePositives}/${row.reportedRows} fn=${row.falseNegatives} coverage=${row.coverage.compared}/${row.coverage.total} comparisons=${row.comparisons} latency=${row.durationMs}ms`);
}
console.log("\n=== 重复检测完整指标表 ===");
console.log("scale, ground_truth_count, candidate_hits, top1_hits, top3_hits, false_positive_count, false_negative_count, recall, precision, top1_recall, top3_recall, coverage, candidate_count, comparisons, latency_ms");
for (const row of duplicateMetrics) {
  const positiveRows = row.pairs.filter((pair) => pair.role === "positive");
  const candidateHits = positiveRows.filter((pair) => pair.recalled).length;
  const top1Hits = positiveRows.filter((pair) => pair.top1).length;
  const top3Hits = positiveRows.filter((pair) => pair.top3).length;
  console.log([
    row.dataset,
    row.positivePairs,
    candidateHits,
    top1Hits,
    top3Hits,
    row.falsePositives,
    row.falseNegatives,
    row.candidateRecall,
    row.precision,
    row.top1Recall,
    row.top3Recall,
    `${row.coverage.compared}/${row.coverage.total}`,
    row.coverage.compared,
    row.comparisons,
    row.durationMs,
  ].join(", "));
}
console.log("报告已写入 outputs/scale-benchmark.json");
