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

const helpers = sqlite ? loadTsModule("app/lib/question-source-access.ts") : null;

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

  run(...params) {
    if (params.length) this.params = params;
    const info = this.db.prepare(this.sql).run(...this.params);
    const meta = { changes: Number(info.changes || 0), lastRowId: Number(info.lastInsertRowid || 0) };
    return { meta, lastInsertRowid: meta.lastRowId };
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

function setupDatabase() {
  const db = new sqlite(":memory:");
  db.exec(`
    CREATE TABLE question_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER,
      source_document TEXT
    );
    CREATE TABLE questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_set_id INTEGER
    );
    CREATE TABLE lesson_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL
    );
    CREATE TABLE lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER
    );
    CREATE TABLE paper_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL
    );
    CREATE TABLE papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER,
      paper_id INTEGER
    );
    CREATE TABLE assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER,
      paper_id INTEGER,
      class_id INTEGER
    );
    CREATE TABLE lesson_workflow_state (
      lesson_id INTEGER PRIMARY KEY,
      homework_paper_id INTEGER
    );
    CREATE TABLE staff_class_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL
    );
  `);
  return new D1Adapter(db);
}

function objectStore(entries) {
  return {
    entries,
    get: async (key) => entries[key] ?? null,
  };
}

const access = (role, id = 10) => ({ id, name: "测试账号", email: "test@local.invalid", roles: [role], role });

test("route source keeps server fingerprint and enforces key authorization", async () => {
  const [sourceRoute, importRoute, setIdRoute] = await Promise.all([
    readFileSync(new URL("../app/api/question-sets/source/route.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../app/api/question-sets/import/route.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../app/api/question-sets/[id]/source/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sourceRoute, /fingerprint:\s*digest/);
  assert.match(sourceRoute, /canReadQuestionSourceObject/);
  assert.match(sourceRoute, /status: 403/);
  assert.match(importRoute, /customMetadata\?\.fingerprint/);
  assert.match(importRoute, /serverFingerprint/);
  assert.match(importRoute, /status: 409/);
  assert.match(importRoute, /sourceFingerprint = serverFingerprint/);
  assert.match(setIdRoute, /hasQuestionSetClassAccess/);
  assert.match(setIdRoute, /status: 403/);
});

test("teacher reads any existing source key and missing keys stay 404-equivalent", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const store = objectStore({ "question-sources/2026-01-01/a.docx": { customMetadata: { uploadedBy: "1", fingerprint: "fp" } } });
  assert.equal(await helpers.canReadQuestionSourceObject(access("teacher", 1), db, store.entries["question-sources/2026-01-01/a.docx"], "question-sources/2026-01-01/a.docx"), true);
  assert.equal(await helpers.canReadQuestionSourceObject(access("teacher", 1), db, null, "question-sources/2026-01-01/missing.docx"), false);
});

test("assistant can read own uploads but denies unassociated foreign uploads", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const store = objectStore({
    "question-sources/2026-01-01/own.docx": { customMetadata: { uploadedBy: "10", fingerprint: "fp" } },
    "question-sources/2026-01-01/teacher.docx": { customMetadata: { uploadedBy: "1", fingerprint: "fp" } },
  });
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/own.docx"], "question-sources/2026-01-01/own.docx"), true);
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/teacher.docx"], "question-sources/2026-01-01/teacher.docx"), false, "unassociated foreign uploads must not be readable without an authorized link");
});

test("assistant is denied an associated key without class access", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  db.prepare("INSERT INTO question_sets(paper_id,source_document) VALUES(?,?)").run(null, "question-sources/2026-01-01/teacher.docx");
  const store = objectStore({ "question-sources/2026-01-01/teacher.docx": { customMetadata: { uploadedBy: "1", fingerprint: "fp" } } });
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/teacher.docx"], "question-sources/2026-01-01/teacher.docx"), false);
});

test("assistant can read an associated key through a lesson class", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const setId = Number(db.prepare("INSERT INTO question_sets(paper_id,source_document) VALUES(?,?)").run(null, "question-sources/2026-01-01/lesson.docx").lastInsertRowid);
  const questionId = Number(db.prepare("INSERT INTO questions(question_set_id) VALUES(?)").run(setId).lastInsertRowid);
  db.prepare("INSERT INTO lessons(id,class_id) VALUES(?,?)").run(3, 7);
  db.prepare("INSERT INTO lesson_questions(lesson_id,question_id) VALUES(?,?)").run(3, questionId);
  db.prepare("INSERT INTO staff_class_access(user_id,class_id) VALUES(?,?)").run(10, 7);
  const store = objectStore({ "question-sources/2026-01-01/lesson.docx": { customMetadata: { uploadedBy: "1", fingerprint: "fp" } } });
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/lesson.docx"], "question-sources/2026-01-01/lesson.docx"), true);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 99), false);
});

test("assistant can read an associated key through paper assessment, assignment and workflow links", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const setId = Number(db.prepare("INSERT INTO question_sets(paper_id,source_document) VALUES(?,?)").run(null, "question-sources/2026-01-01/paper.docx").lastInsertRowid);
  const questionId = Number(db.prepare("INSERT INTO questions(question_set_id) VALUES(?)").run(setId).lastInsertRowid);
  const paperId = Number(db.prepare("INSERT INTO papers DEFAULT VALUES").run().lastInsertRowid);
  db.prepare("INSERT INTO paper_questions(paper_id,question_id) VALUES(?,?)").run(paperId, questionId);
  db.prepare("INSERT INTO staff_class_access(user_id,class_id) VALUES(?,?)").run(10, 8);

  db.prepare("INSERT INTO assessments(class_id,paper_id) VALUES(?,?)").run(8, paperId);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 10), true);
  db.prepare("DELETE FROM assessments").run();

  db.prepare("INSERT INTO assignments(lesson_id,paper_id,class_id) VALUES(?,?,?)").run(null, paperId, 8);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 10), true);
  db.prepare("DELETE FROM assignments").run();

  db.prepare("INSERT INTO lessons(id,class_id) VALUES(?,?)").run(4, 8);
  db.prepare("INSERT INTO lesson_workflow_state(lesson_id,homework_paper_id) VALUES(?,?)").run(4, paperId);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 10), true);

  const store = objectStore({ "question-sources/2026-01-01/paper.docx": { customMetadata: { uploadedBy: "1", fingerprint: "fp" } } });
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/paper.docx"], "question-sources/2026-01-01/paper.docx"), true);
});

test("assistant can read a set through question_sets.paper_id assessment links", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const paperId = Number(db.prepare("INSERT INTO papers DEFAULT VALUES").run().lastInsertRowid);
  const setId = Number(db.prepare("INSERT INTO question_sets(paper_id,source_document) VALUES(?,?)").run(paperId, "question-sources/2026-01-01/own-paper.docx").lastInsertRowid);
  db.prepare("INSERT INTO assessments(class_id,paper_id) VALUES(?,?)").run(9, paperId);
  db.prepare("INSERT INTO staff_class_access(user_id,class_id) VALUES(?,?)").run(10, 9);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 10), true);
  assert.equal(await helpers.hasQuestionSetClassAccess(db, setId, 11), false);
});

test("malicious keys cannot bypass object existence and non-assistant roles are denied", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const store = objectStore({});
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, null, "../../etc/passwd"), false);
  assert.equal(await helpers.canReadQuestionSourceObject(access("student"), db, { customMetadata: { uploadedBy: "10" } }, "question-sources/2026-01-01/own.docx"), false);
  assert.equal(await helpers.canReadQuestionSourceObject(access("parent"), db, { customMetadata: { uploadedBy: "10" } }, "question-sources/2026-01-01/own.docx"), false);
  assert.equal(await helpers.canReadQuestionSourceObject(access("assistant"), db, store.entries["question-sources/2026-01-01/missing.docx"] ?? null, "question-sources/2026-01-01/missing.docx"), false);
});
