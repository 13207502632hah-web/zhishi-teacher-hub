import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const root = fileURLToPath(new URL("../", import.meta.url));

function d1Adapter(sqlite) {
  class Prepared {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Prepared(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
    async run() { const result = sqlite.prepare(this.sql).run(...this.values); return { results: [], success: true, meta: { changes: Number(result.changes || 0) } }; }
  }
  return { prepare(sql) { return new Prepared(sql); }, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } };
}

function moduleLoader(env, cookie) {
  const cache = new Map();
  const load = (absolutePath) => {
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
    const source = readFileSync(absolutePath, "utf8"), { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }), target = { exports: {} };
    cache.set(absolutePath, target);
    const localRequire = (specifier) => {
      if (specifier === "cloudflare:workers") return { env };
      if (specifier === "next/headers") return { headers: async () => ({ get: (name) => name.toLowerCase() === "cookie" ? cookie.value : null }) };
      if (absolutePath.endsWith("access.ts") && specifier === "./teacher-auth") return { getTeacherAdminSession: async () => null };
      if (!specifier.startsWith(".")) return require(specifier);
      const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
      return load(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`);
    };
    new Function("module", "exports", "require", outputText)(target, target.exports, localRequire);
    return target.exports;
  };
  return (relative) => load(fileURLToPath(new URL(relative, pathToFileURL(root))));
}

test("assistant credentials, revocation and class scope work against a real SQLite contract", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT UNIQUE,name TEXT NOT NULL);
    CREATE TABLE user_roles(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,role_id INTEGER NOT NULL);
    CREATE TABLE classes(id INTEGER PRIMARY KEY,owner_id INTEGER,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE staff_class_access(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,class_id INTEGER NOT NULL);
    CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE enrollments(id INTEGER PRIMARY KEY,class_id INTEGER NOT NULL,student_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity_type TEXT,entity_id TEXT,detail TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const migration = readFileSync(new URL("../drizzle/0031_staff_authentication.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) sqlite.exec(statement);
  sqlite.exec(`INSERT INTO roles(id,code,name) VALUES(1,'assistant','助教'),(2,'teacher','教师');
    INSERT INTO users(id,name,email,status) VALUES(10,'测试助教','assistant@example.test','active');
    INSERT INTO user_roles(user_id,role_id) VALUES(10,1);
    INSERT INTO classes(id,owner_id,name,status) VALUES(21,NULL,'授权班','active'),(22,NULL,'未授权班','active');
    INSERT INTO staff_class_access(user_id,class_id) VALUES(10,21);
    INSERT INTO students(id,name,status) VALUES(31,'授权学生','active'),(32,'未授权学生','active');
    INSERT INTO enrollments(class_id,student_id,status) VALUES(21,31,'active'),(22,32,'active');`);
  const cookie = { value: "" }, env = { DB: d1Adapter(sqlite), TEACHER_ADMIN_SESSION_SECRET: "test-session-secret-with-enough-entropy" }, load = moduleLoader(env, cookie), auth = load("app/lib/staff-auth.ts");

  const password = "Strong-Assistant-2026!";
  assert.deepEqual(await auth.setStaffPassword(10, password), { ok: true });
  assert.equal((await auth.verifyStaffCredentials("assistant@example.test", password))?.userId, 10);
  assert.equal(await auth.verifyStaffCredentials("assistant@example.test", "wrong-password"), null);

  cookie.value = (await auth.createStaffSessionCookie(10)).split(";", 1)[0];
  assert.equal((await auth.getStaffSession())?.userId, 10);
  const accessModule = load("app/lib/access.ts"), access = await accessModule.getAccess();
  assert.equal(access.role, "assistant");
  assert.equal(access.authType, "staff");
  assert.equal(accessModule.can(access, "lessons:write"), true);
  assert.equal(accessModule.can(access, "settings:write"), false);
  assert.equal(await accessModule.hasClassAccess(access, 21), true);
  assert.equal(await accessModule.hasClassAccess(access, 22), false);
  assert.equal(await accessModule.hasStudentAccess(access, 31), true);
  assert.equal(await accessModule.hasStudentAccess(access, 32), false);

  await auth.revokeStaffSessions(10);
  assert.equal(await auth.getStaffSession(), null);
  for (let index = 0; index < 5; index++) await auth.recordStaffLoginFailure("test-key");
  assert.equal((await auth.staffLoginAttemptStatus("test-key")).blocked, true);
  sqlite.close();
});
