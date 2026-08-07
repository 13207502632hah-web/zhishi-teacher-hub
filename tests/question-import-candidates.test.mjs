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

function setupDatabase(questionCount) {
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
  for (let index = 0; index < questionCount; index++) {
    insert.run(
      `题干 ${index}`,
      `fp-${index}`,
      index % 3 === 0 ? "单选题" : "材料题",
      "高中",
      "高一",
      "active",
    );
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
  const db = setupDatabase(1300);
  const refs = helpers.buildSourceQuestionRefs(
    [{ stem: "新题", fingerprint: "new-fp", sourceQuestionNumber: 1 }],
    prepareQuestion,
  );
  const { candidates, coverage } = await helpers.collectSimilarityCandidates(db, refs);
  assert.equal(candidates.length, helpers.QUESTION_SIMILARITY_BUDGET);
  assert.equal(coverage.total, 1300);
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
