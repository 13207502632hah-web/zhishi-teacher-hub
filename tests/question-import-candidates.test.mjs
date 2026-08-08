import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

let sqlite = null;
try {
  ({ DatabaseSync: sqlite } = await import("node:sqlite"));
} catch {
  sqlite = null;
}

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
const loadTsModule = (path) =>
  requireTs(fileURLToPath(new URL(`../${path}`, import.meta.url)));

const helpers = sqlite ? loadTsModule("app/lib/question-import-candidates.ts") : null;

class D1Statement {
  constructor(db, statementSql) {
    this.db = db;
    this.sql = statementSql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
}

class D1Adapter {
  constructor(db) {
    this.db = db;
  }

  prepare(statementSql) {
    return new D1Statement(this.db, statementSql);
  }
}

function setupDatabase(questionCount, plant = null) {
  const db = new sqlite(":memory:");
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
  const insert = db.prepare(
    "INSERT INTO questions(stem,fingerprint,question_type,stage,grade,status) VALUES(?,?,?,?,?,?)",
  );
  const plants = Array.isArray(plant) ? plant : plant ? [plant] : [];
  db.exec("BEGIN");
  try {
    for (let index = 0; index < questionCount; index++) {
      const planted = plants.find((item) => item.index === index);
      if (planted) {
        insert.run(planted.stem, planted.fingerprint, planted.questionType, planted.stage, planted.grade, "active");
      } else {
        insert.run(
          `题干 ${index}`,
          `fp-${index}`,
          index % 3 === 0 ? "单选题" : "材料题",
          "高中",
          "高一",
          "active",
        );
      }
    }
  } finally {
    db.exec("COMMIT");
  }
  return new D1Adapter(db);
}

const prepareQuestion = (raw) => ({
  stem: String(raw.stem || ""),
  fingerprint: String(raw.fingerprint || ""),
  questionType: "单选题",
  stage: "高中",
  grade: "高一",
});

test("sourceIndex and sourceQuestionNumber survive exact dedupe and internal duplicates", { skip: !sqlite }, () => {
  const input = [
    { stem: "第一题", fingerprint: "dup-a", sourceQuestionNumber: 1 },
    { stem: "第二题", fingerprint: "uniq-b", sourceQuestionNumber: 2 },
    { stem: "第一题副本", fingerprint: "dup-a", sourceQuestionNumber: 3 },
    { stem: "第三题", fingerprint: "uniq-c", sourceQuestionNumber: 4 },
    { stem: "第四题", fingerprint: "uniq-d", sourceQuestionNumber: 5 },
  ];
  const refs = helpers.buildSourceQuestionRefs(input, prepareQuestion);
  assert.deepEqual(refs.map((ref) => ref.sourceIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(refs.map((ref) => ref.sourceQuestionNumber), [1, 2, 3, 4, 5]);

  const unique = helpers.uniqueSourceRefs(refs);
  assert.deepEqual(unique.map((ref) => ref.sourceIndex), [0, 1, 3, 4]);

  const duplicates = helpers.exactDuplicateRows(refs, new Set());
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].sourceIndex, 2, "internal duplicate keeps its own original index");
  assert.equal(duplicates[0].number, 3, "internal duplicate keeps its own original question number");
});

test("similarity report keeps original numbering after an earlier exact duplicate", { skip: !sqlite }, () => {
  const input = [
    { stem: "重复题干", fingerprint: "dup", sourceQuestionNumber: 1 },
    { stem: "候选题干A", fingerprint: "a", sourceQuestionNumber: 2 },
  ];
  const refs = helpers.buildSourceQuestionRefs(input, prepareQuestion);
  const unique = helpers.uniqueSourceRefs(refs);
  const similar = helpers.scanSimilarityCandidates(
    unique,
    [{ id: 901, stem: "候选题干A 变体", fingerprint: "db-a" }],
    { compare: (left) => left.includes("候选题干A") ? 0.95 : 0.1 },
  );
  assert.equal(similar.length, 1);
  assert.equal(similar[0].sourceIndex, 1, "filtered index must never replace sourceIndex");
  assert.equal(similar[0].sourceQuestionNumber, 2);
});

test("similarity scan keeps only the top three candidates per source ref", { skip: !sqlite }, () => {
  const refs = helpers.buildSourceQuestionRefs(
    [{ stem: "题干X", fingerprint: "x", sourceQuestionNumber: 7 }],
    prepareQuestion,
  );
  const candidates = [1, 2, 3, 4].map((id) => ({
    id,
    stem: `题干X 变体 ${id}`,
    fingerprint: `db-${id}`,
  }));
  const similar = helpers.scanSimilarityCandidates(refs, candidates, {
    compare: (_left, right) => 0.82 + candidates.findIndex((item) => item.stem === right) * 0.02,
  });
  assert.equal(similar.length, 3);
  assert.deepEqual(similar.map((item) => item.candidateId), [4, 3, 2]);
});

test("candidate collection is bounded and reports incomplete coverage above budget", { skip: !sqlite }, async () => {
  const db = setupDatabase(2500);
  const refs = helpers.buildSourceQuestionRefs(
    [{ stem: "新题", fingerprint: "new-fp", sourceQuestionNumber: 1 }],
    prepareQuestion,
  );
  const { candidates, coverage } = await helpers.collectSimilarityCandidates(db, refs);
  assert.equal(candidates.length, helpers.QUESTION_SIMILARITY_BUDGET);
  assert.equal(coverage.total, 2500);
  assert.equal(coverage.compared, helpers.QUESTION_SIMILARITY_BUDGET);
  assert.equal(coverage.complete, false);
});

test("candidate collection marks full coverage when the whole bank fits the budget", { skip: !sqlite }, async () => {
  const db = setupDatabase(500);
  const refs = helpers.buildSourceQuestionRefs(
    [{ stem: "新题", fingerprint: "new-fp", sourceQuestionNumber: 1 }],
    prepareQuestion,
  );
  const { coverage } = await helpers.collectSimilarityCandidates(db, refs);
  assert.equal(coverage.total, 500);
  assert.equal(coverage.complete, true);
});

test("token retrieval recalls a near-duplicate outside the old first-2000 pool", { skip: !sqlite }, async () => {
  const db = setupDatabase(5000, {
    index: 3500,
    stem: "新题 0 近似题干变体",
    fingerprint: "fp-3500",
    questionType: "解答题",
    stage: "初中",
    grade: "初三",
  });
  const planted = db.db.prepare("SELECT id FROM questions WHERE fingerprint=?").get("fp-3500");
  assert.ok(planted, "planted row must exist");
  const plantedId = Number(planted.id);
  const refs = helpers.buildSourceQuestionRefs(
    [{ stem: "新题 0 近似题干变体", fingerprint: "new-fp", sourceQuestionNumber: 1 }],
    prepareQuestion,
  );
  const { candidates, coverage } = await helpers.collectSimilarityCandidates(db, refs);
  assert.ok(
    candidates.some((candidate) => candidate.id === plantedId),
    "attribute-different near-duplicate must still be recalled by stem tokens",
  );
  assert.equal(coverage.complete, false);
  assert.ok(candidates.length <= helpers.QUESTION_SIMILARITY_BUDGET);
  const similar = helpers.scanSimilarityCandidates(refs, candidates);
  assert.ok(
    similar.some((row) => row.candidateId === plantedId),
    "recalled candidate must reach the similarity report",
  );
});

test("text signature recall reaches rows outside the latest-2000 pool when metadata matches the whole bank", { skip: !sqlite }, async () => {
  const plants = [
    { index: 500, stem: "基础题干 0。材料分析！", fingerprint: "old-fp-0", questionType: "单选题", stage: "高中", grade: "高一" },
    { index: 750, stem: "基础题干 1 坚持  人民民主", fingerprint: "old-fp-1", questionType: "单选题", stage: "高中", grade: "高一" },
    { index: 1000, stem: "边界外 题干 11 近似变体乙 的表述", fingerprint: "old-fp-2", questionType: "单选题", stage: "高中", grade: "高一" },
  ];
  const db = setupDatabase(5000, plants);
  const plantedIds = plants.map((plant) => Number(db.db.prepare("SELECT id FROM questions WHERE fingerprint=?").get(plant.fingerprint).id));
  const refs = helpers.buildSourceQuestionRefs(
    [
      { stem: "基础题干 0 材料分析", fingerprint: "ref-fp-0", sourceQuestionNumber: 1 },
      { stem: "基础题干 1 坚持人民民主", fingerprint: "ref-fp-1", sourceQuestionNumber: 2 },
      { stem: "边界外 题干 11 近似变体乙", fingerprint: "ref-fp-2", sourceQuestionNumber: 3 },
    ],
    prepareQuestion,
  );
  const { candidates, coverage } = await helpers.collectSimilarityCandidates(db, refs);
  for (const plantedId of plantedIds) {
    assert.ok(
      candidates.some((candidate) => candidate.id === plantedId),
      `old row ${plantedId} must be recalled outside the latest-2000 pool`,
    );
  }
  assert.ok(candidates.length <= helpers.QUESTION_SIMILARITY_BUDGET);
  assert.equal(coverage.complete, false);
  const similar = helpers.scanSimilarityCandidates(refs, candidates);
  for (const plantedId of plantedIds) {
    assert.ok(
      similar.some((row) => row.candidateId === plantedId),
      `recalled old row ${plantedId} must reach the similarity report`,
    );
  }
});

test("recall and bounded coverage hold at 1k/5k/20k/50k question banks", { skip: !sqlite }, async () => {
  for (const size of [1000, 5000, 20000, 50000]) {
    const db = setupDatabase(size, {
      index: size - 1,
      stem: "规模题干 近似副本 700",
      fingerprint: "plant-fp",
      questionType: "解答题",
      stage: "小学",
      grade: "三年级",
    });
    const planted = db.db.prepare("SELECT id FROM questions WHERE fingerprint=?").get("plant-fp");
    const plantedId = Number(planted.id);
    const refs = helpers.buildSourceQuestionRefs(
      [{ stem: "规模题干 近似副本 700", fingerprint: "new-fp", sourceQuestionNumber: 1 }],
      prepareQuestion,
    );
    const { candidates, coverage } = await helpers.collectSimilarityCandidates(db, refs);
    assert.ok(
      candidates.some((candidate) => candidate.id === plantedId),
      `${size} 题库必须召回 planted 近似题`,
    );
    assert.ok(candidates.length <= helpers.QUESTION_SIMILARITY_BUDGET, `${size} 题库候选池有界`);
    assert.ok(coverage.total <= size, `${size} 题库 coverage.total 不应超过题库总量`);
    assert.equal(coverage.total, size, `${size} 题库条件命中量应与题库总量一致`);
    assert.equal(
      coverage.complete,
      size <= helpers.QUESTION_SIMILARITY_BUDGET,
      `${size} 题库 coverage.complete 应反映候选池是否取尽`,
    );
  }
});
