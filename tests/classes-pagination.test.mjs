import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
    const finalPath = existsSync(withExtension) ? withExtension : `${resolved}/index.ts`;
    if (finalPath.endsWith(path.join("app", "lib", "access.ts"))) {
      const stub = { exports: accessStub };
      resolvedStubModules.set(finalPath, stub);
      return accessStub;
    }
    if (finalPath.endsWith(path.join("app", "lib", "teacher-auth.ts"))) {
      const stub = { exports: teacherAuthStub };
      resolvedStubModules.set(finalPath, stub);
      return teacherAuthStub;
    }
    return requireTs(finalPath);
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
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER,
      name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      course_type TEXT,
      start_date TEXT,
      schedule TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
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
      course_name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE student_lesson_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      risk_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lesson_id, student_id)
    );
  `);
  const adapter = new CountingAdapter(db);
  globalThis.__perfEnv = { DB: adapter };
  return { db, adapter };
}

function insertClasses(db, count = 4300) {
  const insert = db.prepare(`
    INSERT INTO classes(owner_id,name,stage,grade,course_type,start_date,schedule,notes,status)
    VALUES(?,?,?,?,?,?,?,?,?)
  `);
  for (let index = 1; index <= count; index++) {
    insert.run(
      1,
      `班级-${String(index).padStart(4, "0")}`,
      "初中",
      "初二",
      "一对多",
      "2026-09-01",
      "",
      "",
      "active",
    );
  }
}

const classesRoute = () => loadTsModule("app/api/classes/route.ts");
const optionsRoute = () => loadTsModule("app/api/classes/options/route.ts");

const getJson = async (routeModule, pathname, search) => {
  const url = `http://localhost${pathname}${search ? `?${search}` : ""}`;
  const response = await routeModule.GET(new Request(url));
  return { response, data: await response.json() };
};

const searchParams = (params) => new URLSearchParams(params).toString();

test("4300 classes paginate with a bounded page and stable total", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  insertClasses(db, 4300);

  const first = await getJson(classesRoute(), "/api/classes");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.classes.length, 50, "default page must stay bounded");
  assert.equal(first.data.total, 4300);
  assert.equal(first.data.page, 1);
  assert.equal(first.data.pageSize, 50);
  assert.equal(first.data.pageCount, 86);

  const second = await getJson(classesRoute(), "/api/classes", searchParams({ page: "2" }));
  assert.equal(second.response.status, 200);
  assert.equal(second.data.classes.length, 50);
  const firstIds = new Set(first.data.classes.map((item) => item.id));
  assert.ok(
    second.data.classes.every((item) => !firstIds.has(item.id)),
    "page 2 must not repeat page 1 rows",
  );
});

test("class search reaches rows beyond the first page", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  insertClasses(db, 4300);

  const result = await getJson(classesRoute(), "/api/classes", searchParams({ q: "班级-4200" }));
  assert.equal(result.response.status, 200);
  assert.equal(result.data.total, 1);
  assert.equal(result.data.classes[0].name, "班级-4200");
  assert.ok(result.data.classes[0].id >= 4200);
});

test("/api/classes/options stays bounded and filters by q", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  insertClasses(db, 4300);

  const all = await getJson(optionsRoute(), "/api/classes/options");
  assert.equal(all.response.status, 200);
  assert.equal(all.data.classes.length, 50, "options must never return more than 50 rows");
  assert.equal(all.data.total, 4300);

  const filtered = await getJson(optionsRoute(), "/api/classes/options", searchParams({ q: "班级-4100" }));
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(filtered.data.classes.map((item) => item.name), ["班级-4100"]);
  assert.equal(filtered.data.total, 1);
});

test("a class beyond the first 50 is reachable through options q and ids", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  insertClasses(db, 4300);

  const byQ = await getJson(optionsRoute(), "/api/classes/options", searchParams({ q: "班级-4300" }));
  assert.equal(byQ.data.classes.length, 1);
  assert.equal(byQ.data.classes[0].name, "班级-4300");
  assert.equal(byQ.data.classes[0].id, 4300);

  const byIds = await getJson(optionsRoute(), "/api/classes/options", searchParams({ ids: "4300" }));
  assert.equal(byIds.data.classes.length, 1);
  assert.equal(byIds.data.classes[0].name, "班级-4300");
});

test("paginated classes payload drops at least 80% versus the full list", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  insertClasses(db, 4300);

  const all = [];
  for (let page = 1; page <= 22; page++) {
    const part = await getJson(classesRoute(), "/api/classes", searchParams({ pageSize: "200", page: String(page) }));
    assert.equal(part.response.status, 200);
    all.push(...part.data.classes);
  }
  assert.equal(all.length, 4300);
  const fullBytes = Buffer.byteLength(JSON.stringify({ classes: all }), "utf8");

  const result = await getJson(classesRoute(), "/api/classes");
  assert.equal(result.response.status, 200);
  const defaultBytes = Buffer.byteLength(JSON.stringify(result.data), "utf8");
  assert.ok(
    defaultBytes < fullBytes * 0.2,
    `default page must cut at least 80% of the full classes payload (${defaultBytes} bytes vs ${fullBytes} bytes)`,
  );

  const options = await getJson(optionsRoute(), "/api/classes/options");
  const optionsBytes = Buffer.byteLength(JSON.stringify(options.data), "utf8");
  assert.ok(optionsBytes < 100_000, `options payload must stay small, got ${optionsBytes} bytes`);
  assert.ok(
    optionsBytes < fullBytes * 0.2,
    `options payload must cut at least 80% of the full classes payload (${optionsBytes} bytes vs ${fullBytes} bytes)`,
  );
});
