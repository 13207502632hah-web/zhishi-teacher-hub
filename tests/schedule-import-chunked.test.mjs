import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const resolvedStubModules = new Map();

const accessStub = {
  requirePermission: async () => ({
    id: 1,
    name: "测试教师",
    email: "teacher@local.invalid",
    roles: ["teacher"],
    role: "teacher",
  }),
  isDenied: () => false,
  audit: async () => {},
  can: () => true,
  roleName: { teacher: "教师", assistant: "助教", student: "学生", parent: "家长" },
};

const teacherAuthStub = {
  requireTeacherAdminApi: async () => null,
  requireTeacherAdmin: async () => {},
  getTeacherAdminSession: async () => ({ sv: 1 }),
};

const requireTs = (absolutePath) => {
  const normalized = path.resolve(absolutePath);
  if (tsModuleCache.has(normalized)) return tsModuleCache.get(normalized).exports;
  if (resolvedStubModules.has(normalized)) return resolvedStubModules.get(normalized).exports;
  const source = readFileSync(normalized, "utf8");
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  tsModuleCache.set(normalized, evaluatedModule);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) {
      if (specifier === "cloudflare:workers") {
        return { get env() { return globalThis.__perfEnv; } };
      }
      return require(specifier);
    }
    const resolved = fileURLToPath(new URL(specifier, pathToFileURL(normalized)));
    const withExtension = /\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`;
    if (withExtension.endsWith(path.join("app", "lib", "access.ts"))) {
      const stub = { exports: accessStub };
      resolvedStubModules.set(withExtension, stub);
      return accessStub;
    }
    if (withExtension.endsWith(path.join("app", "lib", "teacher-auth.ts"))) {
      const stub = { exports: teacherAuthStub };
      resolvedStubModules.set(withExtension, stub);
      return teacherAuthStub;
    }
    return requireTs(withExtension);
  };
  new Function("module", "exports", "require", code)(evaluatedModule, evaluatedModule.exports, localRequire);
  return evaluatedModule.exports;
};

const loadTsModule = (relative) =>
  requireTs(fileURLToPath(new URL(`../${relative}`, import.meta.url)));

class RouteStatement {
  constructor(db, statementSql, adapter) {
    this.db = db;
    this.sql = statementSql;
    this.adapter = adapter;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    this.adapter.onQuery(this.sql);
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  first() {
    this.adapter.onQuery(this.sql);
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async run() {
    this.adapter.onQuery(this.sql);
    if (this.adapter.beforeRun) await this.adapter.beforeRun(this.sql);
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      meta: {
        changes: Number(info.changes || 0),
        lastRowId: Number(info.lastInsertRowid || 0),
      },
    };
  }
}

class CountingAdapter {
  constructor(db) {
    this.db = db;
    this.sqlCount = 0;
    this.readCount = 0;
    this.writeCount = 0;
    this.statements = [];
    this.beforeRun = null;
  }

  prepare(statementSql) {
    return new RouteStatement(this.db, statementSql, this);
  }

  onQuery(sql) {
    this.sqlCount += 1;
    const trimmed = sql.trim().toLowerCase();
    if (/^(select|with|explain|pragma)/.test(trimmed)) this.readCount += 1;
    else this.writeCount += 1;
    this.statements.push(sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function setupDatabase() {
  const db = new sqlite(":memory:");
  db.exec(`
    CREATE TABLE schedule_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      mapping TEXT,
      report TEXT,
      status TEXT NOT NULL DEFAULT 'preview',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE schedule_import_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      row_number INTEGER NOT NULL,
      raw_data TEXT NOT NULL,
      normalized_data TEXT,
      action TEXT NOT NULL DEFAULT 'pending',
      issue TEXT,
      lesson_id INTEGER,
      processing_state TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      source_lineage TEXT,
      source_row_id TEXT,
      source_cell TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER,
      name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      course_type TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grade TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE(class_id, student_id)
    );
    CREATE TABLE lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      mode TEXT NOT NULL DEFAULT 'offline',
      location TEXT,
      course_name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      fee REAL,
      fee_status TEXT NOT NULL DEFAULT 'untracked',
      status TEXT NOT NULL DEFAULT 'draft',
      cancellation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lesson_finance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL UNIQUE,
      payer_type TEXT NOT NULL,
      payer_id INTEGER,
      base_fee REAL NOT NULL DEFAULT 0,
      expected_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'review',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      settlement_cycle TEXT NOT NULL DEFAULT 'monthly',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const adapter = new CountingAdapter(db);
  globalThis.__perfEnv = {
    DB: adapter,
    FILES: { put: async () => ({}) },
  };
  return { db, adapter };
}

const route = () => loadTsModule("app/api/schedule-imports/[id]/confirm/route.ts");

async function createImport(db, prefix) {
  const inserted = db
    .prepare("INSERT INTO schedule_imports(source_name,fingerprint,mapping,report,status) VALUES(?,?,?,?,?) RETURNING id")
    .get(`${prefix}.csv`, `perf-${prefix}`, "{}", "{}", "preview");
  return Number(inserted.id);
}

function rowFor(index, prefix) {
  const date = new Date(Date.UTC(2032, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    date,
    startTime: "09:00",
    endTime: "10:30",
    studentNames: [`${prefix}学生`],
    className: `${prefix}初二1班`,
    courseName: "政治",
    location: `${prefix}教室`,
    baseFee: 100,
    perStudentFee: 20,
    institution: `${prefix}机构`,
    fee: 0,
    settlementCycle: "每月",
    notes: "",
  };
}

function insertRows(db, importId, count, prefix, startRow = 2) {
  const insert = db.prepare(`
    INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,issue,source_lineage,source_row_id,source_cell)
    VALUES(?,?,?,?,?,?,?,?,?)
  `);
  for (let index = 0; index < count; index++) {
    const row = rowFor(index, prefix);
    insert.run(
      importId,
      startRow + index,
      JSON.stringify(row),
      JSON.stringify(row),
      "pending",
      null,
      `file:${prefix}.csv`,
      `tabular-${startRow + index}`,
      null,
    );
  }
}

async function postConfirm(importId) {
  const response = await route().POST(
    new Request(`http://localhost/api/schedule-imports/${importId}/confirm`, { method: "POST" }),
    { params: Promise.resolve({ id: String(importId) }) },
  );
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { response, data, text };
}

async function confirmUntilDone(importId, maxRequests = 20) {
  const requests = [];
  let data = null;
  do {
    const result = await postConfirm(importId);
    data = result.data;
    requests.push(result);
    if (requests.length > maxRequests) throw new Error(`confirm exceeded ${maxRequests} requests`);
  } while (data?.done !== true);
  return requests;
}

const count = (db, table) =>
  Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);

const stateCounts = (db, importId) =>
  db
    .prepare("SELECT COALESCE(processing_state,'') AS state, COUNT(*) AS c FROM schedule_import_rows WHERE import_id=? GROUP BY COALESCE(processing_state,'')")
    .all(importId);

test("120-row confirm is chunked into 50-row requests and replay is idempotent", { skip: !sqlite }, async () => {
  const { db, adapter } = setupDatabase();
  const importId = await createImport(db, "chunk120");
  insertRows(db, importId, 120, "chunk120");

  const requests = await confirmUntilDone(importId);
  assert.equal(requests.length, 3, "120 rows should require exactly three 50-row chunks");
  assert.deepEqual(requests.map((item) => item.response.status), [200, 200, 200]);
  assert.deepEqual(requests.slice(0, 2).map((item) => item.data.done), [false, false]);
  assert.equal(requests[2].data.done, true);
  assert.equal(requests[2].data.status, "confirmed");
  assert.deepEqual(requests.map((item) => item.data.report.created), [50, 50, 20]);

  assert.equal(count(db, "lessons"), 120);
  assert.equal(count(db, "lesson_finance"), 120);
  assert.equal(count(db, "classes"), 1);
  assert.equal(count(db, "students"), 1);
  assert.equal(count(db, "enrollments"), 1);
  assert.equal(count(db, "institutions"), 1);
  const states = stateCounts(db, importId);
  assert.equal(states.find((item) => item.state === "done")?.c, 120);
  assert.ok(adapter.sqlCount > 0, "route should execute real D1 statements");

  const replay = await postConfirm(importId);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.repeated, true);
  assert.equal(replay.data.status, "confirmed");
  assert.equal(count(db, "lessons"), 120, "replay must not create lessons");
  assert.equal(count(db, "lesson_finance"), 120, "replay must not create finance");
  assert.equal(count(db, "classes"), 1);
  assert.equal(count(db, "students"), 1);
});

test("exact 50-row chunk finishes in one request and reports done", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const importId = await createImport(db, "exact50");
  insertRows(db, importId, 50, "exact50");

  const requests = await confirmUntilDone(importId);
  assert.equal(requests.length, 1, "a full 50-row chunk that confirms should not require another request");
  assert.equal(requests[0].data.done, true);
  assert.equal(requests[0].data.status, "confirmed");
  assert.equal(requests[0].data.report.created, 50);
  assert.equal(count(db, "lessons"), 50);
  assert.equal(count(db, "lesson_finance"), 50);
  assert.equal(count(db, "classes"), 1);
  assert.equal(count(db, "students"), 1);

  const replay = await postConfirm(importId);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.repeated, true);
  assert.equal(replay.data.done, true);
  assert.equal(count(db, "lessons"), 50, "replay must not create lessons");
  assert.equal(count(db, "lesson_finance"), 50, "replay must not create finance");
});

test("same class and student reuse the request-scoped identity cache", { skip: !sqlite }, async () => {
  const { db, adapter } = setupDatabase();
  const importId = await createImport(db, "cache60");
  insertRows(db, importId, 60, "cache60");

  await confirmUntilDone(importId);

  const classSelects = adapter.statements.filter((sql) => /from classes/i.test(sql)).length;
  const studentSelects = adapter.statements.filter((sql) => /from students/i.test(sql)).length;
  assert.ok(classSelects > 0, "class lookup should still run for the first row of each chunk");
  assert.ok(studentSelects > 0, "student lookup should still run for the first row of each chunk");
  assert.ok(classSelects <= 2, `class lookup reused across 60 rows: ${classSelects}`);
  assert.ok(studentSelects <= 2, `student lookup reused across 60 rows: ${studentSelects}`);
  assert.equal(count(db, "lessons"), 60);
  assert.equal(count(db, "classes"), 1);
  assert.equal(count(db, "students"), 1);
  assert.equal(count(db, "enrollments"), 1);
});

test("racing confirm requests return one success and one 409 retryLater", { skip: !sqlite }, async () => {
  const { db, adapter } = setupDatabase();
  const importId = await createImport(db, "race2");
  insertRows(db, importId, 2, "race2");

  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  adapter.beforeRun = async (sql) => {
    if (!sql.includes("UPDATE schedule_imports SET status='confirming'")) return;
    arrivals += 1;
    if (arrivals === 1) await gate;
    else release();
  };

  const [first, second] = await Promise.all([postConfirm(importId), postConfirm(importId)]);
  const statuses = [first.response.status, second.response.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);
  const success = [first, second].find((item) => item.response.status === 200);
  const conflict = [first, second].find((item) => item.response.status === 409);
  assert.equal(success.data.status, "confirmed");
  assert.equal(success.data.done, true);
  assert.equal(conflict.data.retryLater, true);
  assert.match(conflict.data.error, /正在处理中/);
  assert.equal(count(db, "lessons"), 2);
  assert.equal(count(db, "lesson_finance"), 2);
  const states = stateCounts(db, importId);
  assert.equal(states.find((item) => item.state === "done")?.c, 2);
});
