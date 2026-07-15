#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MINI_ROOT = path.join(ROOT, "mini-program");
const DRIZZLE_ROOT = path.join(ROOT, "drizzle");
const D1_ROOT = path.join(ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const ARTIFACT_ROOT = path.join(ROOT, ".artifacts/mini");
const DEV_VARS = path.join(ROOT, ".dev.vars");
const DEVTOOLS_CLI = process.env.WECHAT_DEVTOOLS_CLI || "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const BASE_URL = "http://localhost:3000";
const E2E_PREFIX = "__e2e__";
const command = process.argv[2] || "verify";

const report = {
  startedAt: new Date().toISOString(),
  command,
  brand: "满分道法",
  stages: [],
  boundaries: {
    gitPush: false,
    websitePublished: false,
    wechatUploaded: false,
    reviewSubmitted: false,
    previewGenerated: false,
    realDeviceTested: false,
  },
};

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(timeout / 1000)} 秒）`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/(["']token["']\s*:\s*["'])[^"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:secret|token|code)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(-6000);
}

function stage(name, status, detail = {}) {
  report.stages.push({ name, status, at: new Date().toISOString(), ...detail });
  const suffix = detail.summary ? `：${detail.summary}` : "";
  console.log(`${status === "passed" ? "✓" : status === "skipped" ? "-" : "✗"} ${name}${suffix}`);
}

function minimalEnv(extra = {}) {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "LANG", "LC_ALL"];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  return {
    ...env,
    NODE_ENV: "development",
    WRANGLER_WRITE_LOGS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    ...extra,
  };
}

async function runProcess(program, args, options = {}) {
  const output = { stdout: "", stderr: "" };
  const child = spawn(program, args, {
    cwd: options.cwd || ROOT,
    env: options.env || minimalEnv(),
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (!options.inherit) {
    child.stdout.on("data", (chunk) => { output.stdout = (output.stdout + chunk).slice(-200000); });
    child.stderr.on("data", (chunk) => { output.stderr = (output.stderr + chunk).slice(-200000); });
  }
  const timeout = options.timeout || 180000;
  const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  if (result.code !== 0) {
    throw new Error(`${options.label || `${program} ${args.join(" ")}`}失败（${result.code ?? result.signal}）\n${sanitize(output.stderr || output.stdout)}`);
  }
  return output;
}

async function ensurePath(target, mode = fsConstants.F_OK) {
  try { await access(target, mode); return true; } catch { return false; }
}

async function ensurePreflight() {
  for (const target of [MINI_ROOT, path.join(MINI_ROOT, "project.config.json"), path.join(ROOT, "package.json")]) {
    if (!await ensurePath(target)) throw new Error(`缺少项目文件：${target}`);
  }
  if (!await ensurePath(DEVTOOLS_CLI, fsConstants.X_OK)) throw new Error(`未找到微信开发者工具 CLI：${DEVTOOLS_CLI}`);
  await runProcess(process.execPath, ["--version"], { label: "Node 版本检查" });
  await runProcess("pnpm", ["--version"], { label: "pnpm 版本检查" });
  stage("环境预检", "passed", { summary: "Node、pnpm、微信开发者工具 CLI 和项目目录均可用" });
}

async function ensureDevVars() {
  const expected = "WECHAT_TEST_MODE=true";
  if (!await ensurePath(DEV_VARS)) {
    await writeFile(DEV_VARS, `${expected}\n`, { mode: 0o600 });
  } else {
    const assignments = (await readFile(DEV_VARS, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (assignments.length !== 1 || assignments[0] !== expected) {
      throw new Error(".dev.vars 只能包含本地 WECHAT_TEST_MODE=true；为避免读取或覆盖其他凭据，自动化已停止");
    }
  }
  stage("本地测试变量", "passed", { summary: "仅启用 WECHAT_TEST_MODE=true，未读取 .env.local" });
}

async function probeHome() {
  try {
    const response = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1800) });
    const body = await response.text();
    return { reachable: true, valid: response.status === 200 && /知师研室|满分道法/.test(body), status: response.status };
  } catch {
    return { reachable: false, valid: false, status: 0 };
  }
}

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForHome(child, logs, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`本地服务提前退出\n${sanitize(logs.stderr || logs.stdout)}`);
    const state = await probeHome();
    if (state.valid) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待 ${BASE_URL} 超时\n${sanitize(logs.stderr || logs.stdout)}`);
}

async function startServer({ stream = false } = {}) {
  const current = await probeHome();
  if (current.valid) {
    stage("本地服务", "passed", { summary: "复用已运行的 localhost:3000" });
    return { child: null, reused: true, logs: { stdout: "", stderr: "" } };
  }
  if (current.reachable) throw new Error("端口 3000 已被其他 HTTP 服务占用");
  const logs = { stdout: "", stderr: "" };
  const child = spawn("pnpm", ["dev"], { cwd: ROOT, env: minimalEnv(), stdio: ["ignore", "pipe", "pipe"] });
  for (const [name, source] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    source.on("data", (chunk) => {
      logs[name] = (logs[name] + chunk).slice(-200000);
      if (stream) process[name === "stdout" ? "stdout" : "stderr"].write(sanitize(chunk));
    });
  }
  await waitForHome(child, logs);
  stage("本地服务", "passed", { summary: "localhost:3000 已启动" });
  return { child, reused: false, logs };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode != null) return;
  server.child.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (server.child.exitCode == null) server.child.kill("SIGTERM");
}

async function findDatabase() {
  if (!await ensurePath(D1_ROOT)) return null;
  const entries = await readdir(D1_ROOT, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite")
    .map((entry) => path.join(D1_ROOT, entry.name));
  if (!files.length) return null;
  return files[0];
}

async function sqlite(db, sql, label = "本地 D1") {
  return runProcess("sqlite3", [db, sql], { label });
}

async function sqliteRows(db, sql) {
  const result = await runProcess("sqlite3", ["-json", db, sql], { label: "本地 D1 查询" });
  return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}

async function hasTable(db, table) {
  const rows = await sqliteRows(db, `SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='${table}' LIMIT 1;`);
  return rows.length === 1;
}

async function hasColumn(db, table, column) {
  const rows = await sqliteRows(db, `SELECT 1 AS found FROM pragma_table_info('${table}') WHERE name='${column}' LIMIT 1;`);
  return rows.length === 1;
}

async function applyMigration(db, filename, applied) {
  const migration = path.join(DRIZZLE_ROOT, filename);
  if (!await ensurePath(migration)) throw new Error(`缺少迁移：${filename}`);
  await sqlite(db, `.read '${migration}'`, `应用 ${filename}`);
  applied.push(filename);
}

async function verifySchema(db) {
  const tables = [
    "users", "classes", "students", "assignments", "wechat_accounts", "mini_sessions", "mini_invites",
    "parent_student_links", "mini_bindings", "assignment_targets", "assignment_settings", "idempotency_operations",
    "sync_events", "file_leases", "submission_reviews", "reminder_tasks",
  ];
  const missingTables = [];
  for (const table of tables) if (!await hasTable(db, table)) missingTables.push(table);
  const columns = [
    ["assignments", "paper_id"],
    ["assignment_submissions", "review_tags"],
    ["assignments", "class_id"],
    ["assignments", "reminder_rule"],
    ["assignments", "status"],
  ];
  const missingColumns = [];
  for (const [table, column] of columns) if (!await hasColumn(db, table, column)) missingColumns.push(`${table}.${column}`);
  const foreignKeys = await sqliteRows(db, "PRAGMA foreign_key_check;");
  if (missingTables.length || missingColumns.length || foreignKeys.length) {
    throw new Error(`本地 D1 验证失败：缺表 ${missingTables.join(",") || "无"}；缺字段 ${missingColumns.join(",") || "无"}；外键异常 ${foreignKeys.length}`);
  }
}

async function prepareDatabase() {
  await ensureDevVars();
  let db = await findDatabase();
  if (!db) {
    const bootstrap = await startServer();
    await stopServer(bootstrap);
    db = await findDatabase();
  }
  if (!db || !db.startsWith(D1_ROOT)) throw new Error("未找到项目目录内的 Miniflare D1；拒绝连接远程数据库");

  const running = await probeHome();
  const applied = [];
  const schemaReady = await hasTable(db, "users")
    && await hasTable(db, "mini_bindings")
    && await hasTable(db, "feedback_templates")
    && await hasColumn(db, "assignments", "status")
    && await hasColumn(db, "assignments", "paper_id");
  if (running.valid && !schemaReady) throw new Error("本地服务正在使用缺少迁移的 D1；请先停止服务后再运行 mini:prepare");

  await mkdir(path.join(ARTIFACT_ROOT, "backups"), { recursive: true });
  const backup = path.join(ARTIFACT_ROOT, "backups", `local-d1-${timestamp()}.sqlite`);
  await sqlite(db, `.backup '${backup}'`, "备份本地 D1");

  if (!await hasTable(db, "users")) {
    const migrations = (await readdir(DRIZZLE_ROOT)).filter((name) => /^00(?:0\d|1[0-4])_.*\.sql$/.test(name)).sort();
    for (const migration of migrations) await applyMigration(db, migration, applied);
  }
  const migration0014Checks = [
    await hasColumn(db, "assignments", "paper_id"),
    await hasColumn(db, "papers", "year"),
    await hasColumn(db, "feedback", "audience"),
    await hasTable(db, "paper_files"),
    await hasTable(db, "feedback_templates"),
  ];
  if (migration0014Checks.some(Boolean) && !migration0014Checks.every(Boolean)) {
    throw new Error("本地 D1 的 0014 迁移处于部分应用状态；已停止以避免重复 ALTER，请从自动备份恢复后重试");
  }
  if (!migration0014Checks.every(Boolean)) await applyMigration(db, "0014_teacher_feedback_papers.sql", applied);
  const needs0015 = !(await hasTable(db, "wechat_accounts")) || !(await hasTable(db, "mini_sessions")) || !(await hasTable(db, "submission_versions")) || !(await hasTable(db, "file_assets"));
  if (needs0015) await applyMigration(db, "0015_teacher_operations.sql", applied);
  if (!await hasColumn(db, "assignment_submissions", "review_tags")) await applyMigration(db, "0016_assignment_review_tags.sql", applied);
  if (!await hasColumn(db, "assignments", "class_id")) await applyMigration(db, "0017_assignment_class.sql", applied);
  if (!await hasColumn(db, "assignments", "reminder_rule")) await applyMigration(db, "0018_assignment_reminder.sql", applied);
  if (!await hasColumn(db, "assignments", "status")) await applyMigration(db, "0019_assignment_status.sql", applied);
  const newTables = ["mini_bindings", "assignment_targets", "assignment_settings", "idempotency_operations", "sync_events", "file_leases", "submission_reviews", "reminder_tasks"];
  let needs0020 = false;
  for (const table of newTables) if (!await hasTable(db, table)) needs0020 = true;
  if (needs0020) await applyMigration(db, "0020_mini_integration.sql", applied);

  await verifySchema(db);
  stage("本地 D1", "passed", { summary: applied.length ? `已备份并应用 ${applied.join("、")}` : "已备份，0015–0020 均已就绪", backup: path.relative(ROOT, backup) });
  return db;
}

async function cleanupFixtures(db) {
  const sql = `
PRAGMA foreign_keys=ON;
BEGIN;
DELETE FROM excellent_submissions WHERE submission_version_id IN (SELECT sv.id FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '${E2E_PREFIX}%');
DELETE FROM review_annotations WHERE submission_version_id IN (SELECT sv.id FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '${E2E_PREFIX}%');
DELETE FROM submission_assets WHERE submission_version_id IN (SELECT sv.id FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '${E2E_PREFIX}%');
DELETE FROM submission_reviews WHERE submission_id IN (SELECT s.id FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '${E2E_PREFIX}%');
DELETE FROM submission_versions WHERE submission_id IN (SELECT s.id FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.title LIKE '${E2E_PREFIX}%');
DELETE FROM sync_events WHERE account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE 'test:%preview' OR open_id LIKE 'test:${E2E_PREFIX}%') OR student_id IN (SELECT id FROM students WHERE name LIKE '${E2E_PREFIX}%') OR entity_id IN (SELECT CAST(id AS TEXT) FROM assignments WHERE title LIKE '${E2E_PREFIX}%');
DELETE FROM reminder_tasks WHERE operation_id LIKE '${E2E_PREFIX}%' OR (entity_type='assignment' AND entity_id IN (SELECT CAST(id AS TEXT) FROM assignments WHERE title LIKE '${E2E_PREFIX}%'));
DELETE FROM idempotency_operations WHERE operation_id LIKE '${E2E_PREFIX}%';
DELETE FROM assignment_assets WHERE assignment_id IN (SELECT id FROM assignments WHERE title LIKE '${E2E_PREFIX}%');
DELETE FROM assignment_targets WHERE assignment_id IN (SELECT id FROM assignments WHERE title LIKE '${E2E_PREFIX}%');
DELETE FROM assignment_settings WHERE assignment_id IN (SELECT id FROM assignments WHERE title LIKE '${E2E_PREFIX}%');
DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE title LIKE '${E2E_PREFIX}%');
DELETE FROM assignments WHERE title LIKE '${E2E_PREFIX}%';
DELETE FROM parent_student_links WHERE parent_account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE 'test:%preview' OR open_id LIKE 'test:${E2E_PREFIX}%') OR student_id IN (SELECT id FROM students WHERE name LIKE '${E2E_PREFIX}%');
DELETE FROM mini_bindings WHERE account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE 'test:%preview' OR open_id LIKE 'test:${E2E_PREFIX}%') OR student_id IN (SELECT id FROM students WHERE name LIKE '${E2E_PREFIX}%');
DELETE FROM mini_sessions WHERE account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE 'test:%preview' OR open_id LIKE 'test:${E2E_PREFIX}%');
DELETE FROM wechat_accounts WHERE open_id LIKE 'test:%preview' OR open_id LIKE 'test:${E2E_PREFIX}%';
DELETE FROM enrollments WHERE student_id IN (SELECT id FROM students WHERE name LIKE '${E2E_PREFIX}%') OR class_id IN (SELECT id FROM classes WHERE name LIKE '${E2E_PREFIX}%');
DELETE FROM students WHERE name LIKE '${E2E_PREFIX}%';
DELETE FROM staff_class_access WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${E2E_PREFIX}%') OR class_id IN (SELECT id FROM classes WHERE name LIKE '${E2E_PREFIX}%');
DELETE FROM classes WHERE name LIKE '${E2E_PREFIX}%';
DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${E2E_PREFIX}%');
DELETE FROM users WHERE email LIKE '${E2E_PREFIX}%';
COMMIT;`;
  await sqlite(db, sql, "清理合成测试数据");
}

async function seedFixtures(db) {
  await cleanupFixtures(db);
  const sql = `
PRAGMA foreign_keys=ON;
BEGIN;
INSERT OR IGNORE INTO roles(code,name) VALUES('teacher','教师'),('student','学生'),('parent','家长');
INSERT INTO users(name,email,status) VALUES('${E2E_PREFIX}教师','${E2E_PREFIX}teacher@local.invalid','active') ON CONFLICT(email) DO UPDATE SET name=excluded.name,status='active',updated_at=CURRENT_TIMESTAMP;
INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT u.id,r.id FROM users u,roles r WHERE u.email='${E2E_PREFIX}teacher@local.invalid' AND r.code='teacher';
INSERT INTO classes(owner_id,name,stage,grade,course_type,status) SELECT id,'${E2E_PREFIX}自动化班','初中','九年级','道德与法治','active' FROM users WHERE email='${E2E_PREFIX}teacher@local.invalid';
INSERT INTO students(name,grade,school,status,notes) VALUES('${E2E_PREFIX}学生','九年级','本地自动化学校','active','仅用于本地自动化，禁止用于生产');
INSERT INTO enrollments(class_id,student_id,status) SELECT c.id,s.id,'active' FROM classes c,students s WHERE c.name='${E2E_PREFIX}自动化班' AND s.name='${E2E_PREFIX}学生';
INSERT INTO assignments(class_id,title,requirements,due_at,status) SELECT id,'${E2E_PREFIX}自动化作业','仅含合成数据的本地回归作业',datetime('now','+7 day'),'published' FROM classes WHERE name='${E2E_PREFIX}自动化班';
INSERT INTO assignment_settings(assignment_id,allow_parent_submit,require_revision,published_at) SELECT id,1,1,CURRENT_TIMESTAMP FROM assignments WHERE title='${E2E_PREFIX}自动化作业';
INSERT INTO assignment_targets(assignment_id,target_type,target_id) SELECT a.id,'class',c.id FROM assignments a,classes c WHERE a.title='${E2E_PREFIX}自动化作业' AND c.name='${E2E_PREFIX}自动化班';
INSERT INTO assignment_submissions(assignment_id,student_id,status) SELECT a.id,s.id,'pending' FROM assignments a,students s WHERE a.title='${E2E_PREFIX}自动化作业' AND s.name='${E2E_PREFIX}学生';
INSERT INTO wechat_accounts(user_id,student_id,open_id,role,display_name,status) SELECT NULL,s.id,'test:student-preview','student','${E2E_PREFIX}学生账号','active' FROM students s WHERE s.name='${E2E_PREFIX}学生';
INSERT INTO wechat_accounts(user_id,student_id,open_id,role,display_name,status) SELECT NULL,NULL,'test:parent-preview','parent','${E2E_PREFIX}家长账号','active';
INSERT INTO wechat_accounts(user_id,student_id,open_id,role,display_name,status) SELECT u.id,NULL,'test:teacher-preview','teacher','${E2E_PREFIX}教师账号','active' FROM users u WHERE u.email='${E2E_PREFIX}teacher@local.invalid';
INSERT INTO mini_bindings(account_id,student_id,role,status,confirmed_by,confirmed_at) SELECT wa.id,s.id,'student','active',u.id,CURRENT_TIMESTAMP FROM wechat_accounts wa,students s,users u WHERE wa.open_id='test:student-preview' AND s.name='${E2E_PREFIX}学生' AND u.email='${E2E_PREFIX}teacher@local.invalid';
INSERT INTO mini_bindings(account_id,student_id,role,status,confirmed_by,confirmed_at) SELECT wa.id,s.id,'parent','active',u.id,CURRENT_TIMESTAMP FROM wechat_accounts wa,students s,users u WHERE wa.open_id='test:parent-preview' AND s.name='${E2E_PREFIX}学生' AND u.email='${E2E_PREFIX}teacher@local.invalid';
INSERT INTO parent_student_links(parent_account_id,student_id,status,confirmed_by) SELECT wa.id,s.id,'active',u.id FROM wechat_accounts wa,students s,users u WHERE wa.open_id='test:parent-preview' AND s.name='${E2E_PREFIX}学生' AND u.email='${E2E_PREFIX}teacher@local.invalid';
INSERT INTO sync_events(event_type,entity_type,entity_id,student_id,payload) SELECT 'assignment.published','assignment',CAST(a.id AS TEXT),s.id,'{"synthetic":true}' FROM assignments a,students s WHERE a.title='${E2E_PREFIX}自动化作业' AND s.name='${E2E_PREFIX}学生';
COMMIT;`;
  await sqlite(db, sql, "创建合成测试数据");
  const rows = await sqliteRows(db, `SELECT a.id AS assignmentId,s.id AS studentId,c.id AS classId,u.id AS teacherId FROM assignments a,students s,classes c,users u WHERE a.title='${E2E_PREFIX}自动化作业' AND s.name='${E2E_PREFIX}学生' AND c.name='${E2E_PREFIX}自动化班' AND u.email='${E2E_PREFIX}teacher@local.invalid';`);
  if (rows.length !== 1) throw new Error("无法建立唯一的 __e2e__ 合成数据");
  stage("合成测试数据", "passed", { summary: "教师、学生、家长、班级和作业均为 __e2e__ 数据" });
  return rows[0];
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeout || 20000),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "响应不是 JSON" }; }
  if (response.status >= 500) {
    throw new Error(`${options.method || "GET"} ${pathname} 返回 ${response.status}：${sanitize(data.error || "服务端异常")}`);
  }
  return { status: response.status, data };
}

async function login(role, testCode = `${role}-preview`) {
  const response = await jsonRequest("/api/mini/login", { method: "POST", body: JSON.stringify({ testCode, role, displayName: `${E2E_PREFIX}${role}` }) });
  assert.equal(response.status, 200, `${role} 测试登录失败：${response.data.error || response.status}`);
  assert.equal(typeof response.data.token, "string");
  return { ...response.data, headers: { authorization: `Bearer ${response.data.token}` } };
}

async function apiRegression(db, fixture) {
  const results = [];
  const unauthorized = await jsonRequest("/api/mini/me");
  assert.equal(unauthorized.status, 401);
  results.push({ case: "无令牌身份接口", status: 401 });

  const unbound = await login("student", `${E2E_PREFIX}unbound`);
  assert.equal(unbound.bindingRequired, true);
  results.push({ case: "未绑定账号", status: 200, bindingRequired: true });

  const student = await login("student");
  const studentAgain = await login("student");
  assert.equal(student.accountId, studentAgain.accountId, "重复登录不应创建重复账号");
  const me = await jsonRequest("/api/mini/me", { headers: student.headers });
  assert.equal(me.status, 200);
  assert.equal(me.data.bindingRequired, false);
  const sync = await jsonRequest("/api/mini/sync?cursor=0", { headers: student.headers });
  assert.equal(sync.status, 200);
  assert.equal(sync.data.full, true);
  assert.ok(sync.data.snapshot.assignments.some((item) => item.title === `${E2E_PREFIX}自动化作业`));
  results.push({ case: "学生登录、身份与完整同步", status: 200 });

  const forbiddenCreate = await jsonRequest("/api/mini/assignments", {
    method: "POST", headers: student.headers,
    body: JSON.stringify({ title: `${E2E_PREFIX}越权作业`, studentIds: [fixture.studentId], operationId: `${E2E_PREFIX}forbidden` }),
  });
  assert.equal(forbiddenCreate.status, 403);
  results.push({ case: "学生越权布置作业", status: 403 });

  const submitBody = { action: "submit", assignmentId: fixture.assignmentId, textContent: "__e2e__首次提交", assetIds: [], operationId: `${E2E_PREFIX}submission-v1` };
  const firstSubmit = await jsonRequest("/api/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(submitBody) });
  const repeatedSubmit = await jsonRequest("/api/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(submitBody) });
  assert.equal(firstSubmit.status, 201);
  assert.equal(repeatedSubmit.status, 200);
  assert.deepEqual({ id: repeatedSubmit.data.id, version: repeatedSubmit.data.version }, { id: firstSubmit.data.id, version: firstSubmit.data.version });
  results.push({ case: "学生提交幂等", first: 201, replay: 200, version: firstSubmit.data.version });

  const teacher = await login("teacher");
  assert.equal(teacher.teacherLinked, true);
  const teacherAssignments = await jsonRequest("/api/mini/assignments", { headers: teacher.headers });
  assert.equal(teacherAssignments.status, 200);
  const submissions = await jsonRequest(`/api/mini/submissions?assignmentId=${fixture.assignmentId}`, { headers: teacher.headers });
  assert.equal(submissions.status, 200);
  const submission = submissions.data.submissions.find((item) => Number(item.studentId) === Number(fixture.studentId));
  assert.ok(submission);
  const draftReview = await jsonRequest("/api/mini/submissions", { method: "POST", headers: teacher.headers, body: JSON.stringify({ action: "save-review", submissionId: submission.id, outcome: "revision", reviewTags: ["政治术语不规范"], teacherNote: "__e2e__批改草稿", revisionRequirements: "补充规范表述", operationId: `${E2E_PREFIX}review-draft` }) });
  assert.equal(draftReview.status, 201);
  const confirmBody = { action: "confirm-review", submissionId: submission.id, outcome: "revision", reviewTags: ["政治术语不规范"], teacherNote: "__e2e__请订正", revisionRequirements: "补充规范表述", operationId: `${E2E_PREFIX}review-confirm` };
  const confirmed = await jsonRequest("/api/mini/submissions", { method: "POST", headers: teacher.headers, body: JSON.stringify(confirmBody) });
  const confirmedAgain = await jsonRequest("/api/mini/submissions", { method: "POST", headers: teacher.headers, body: JSON.stringify(confirmBody) });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmedAgain.status, 200);
  assert.equal(confirmed.data.id, confirmedAgain.data.id);
  results.push({ case: "教师批改草稿与确认回传", draft: 201, confirm: 200, replay: 200 });

  const revisionBody = { ...submitBody, textContent: "__e2e__订正版", operationId: `${E2E_PREFIX}submission-v2` };
  const revision = await jsonRequest("/api/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(revisionBody) });
  const revisionAgain = await jsonRequest("/api/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(revisionBody) });
  assert.equal(revision.status, 201);
  assert.equal(revisionAgain.status, 200);
  assert.equal(revision.data.version, 2);
  results.push({ case: "学生订正版本与幂等重放", first: 201, replay: 200, version: 2 });

  const parent = await login("parent");
  const parentMe = await jsonRequest("/api/mini/me", { headers: parent.headers });
  assert.equal(parentMe.status, 200);
  assert.equal(parentMe.data.bindingRequired, false);
  const portal = await jsonRequest(`/api/mini/portal?studentId=${fixture.studentId}`, { headers: parent.headers });
  assert.equal(portal.status, 200);
  const teacherPortal = await jsonRequest(`/api/mini/portal?studentId=${fixture.studentId}`, { headers: teacher.headers });
  assert.equal(teacherPortal.status, 400);
  results.push({ case: "家长门户与教师端权限隔离", parent: 200, teacher: 400 });

  const counts = await sqliteRows(db, `SELECT (SELECT COUNT(*) FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id WHERE s.assignment_id=${Number(fixture.assignmentId)}) AS versions,(SELECT COUNT(*) FROM submission_reviews r JOIN assignment_submissions s ON s.id=r.submission_id WHERE s.assignment_id=${Number(fixture.assignmentId)} AND r.status='confirmed') AS confirmedReviews,(SELECT COUNT(*) FROM wechat_accounts WHERE open_id IN ('test:student-preview','test:parent-preview','test:teacher-preview')) AS accounts;`);
  assert.equal(Number(counts[0].versions), 2);
  assert.equal(Number(counts[0].confirmedReviews), 1);
  assert.equal(Number(counts[0].accounts), 3);
  stage("小程序接口回归", "passed", { summary: `${results.length} 组登录、同步、幂等、订正和权限场景通过`, results });
  return results;
}

async function resetMiniSession(miniProgram) {
  await withTimeout(miniProgram.evaluate(() => {
    wx.clearStorageSync();
    const app = getApp();
    app.globalData.token = "";
    app.globalData.role = "student";
    app.globalData.me = null;
    app.globalData.syncCursor = 0;
  }), 20000, "清理模拟器测试会话");
}

async function waitForAutomatorReady(miniProgram, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await withTimeout(miniProgram.currentPage(), 5000, "读取模拟器当前页面");
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`微信开发者工具已开启，但小程序运行时未就绪：${sanitize(lastError?.message)}`);
}

async function waitForPageData(page, predicate, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await page.data();
    if (predicate(data)) return data;
    await page.waitFor(300);
  }
  throw new Error(message);
}

async function simulatorRegression(runDir, fixture) {
  const automator = (await import("miniprogram-automator")).default;
  let miniProgram;
  const evidence = [];
  try {
    const reuseConnection = await isPortOpen(9420);
    miniProgram = await withTimeout(reuseConnection
      ? automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" })
      : automator.launch({
          cliPath: DEVTOOLS_CLI,
          projectPath: MINI_ROOT,
          timeout: 90000,
          port: 9420,
          args: ["--port", "9431"],
          trustProject: true,
        }), reuseConnection ? 30000 : 110000, "连接微信开发者工具自动化端口");
    const exceptions = [];
    miniProgram.on("exception", (error) => exceptions.push(sanitize(JSON.stringify(error))));

    await waitForAutomatorReady(miniProgram);
    await resetMiniSession(miniProgram);
    let page = await miniProgram.reLaunch("/pages/home/index");
    await page.callMethod("login", { currentTarget: { dataset: { role: "student" } } });
    const studentData = await waitForPageData(page, (data) => data.me?.role === "student" && !data.loading, "学生端模拟器登录超时");
    assert.ok(studentData.items.some((item) => item.title === `${E2E_PREFIX}自动化作业`));
    const studentShot = path.join(runDir, "student-home.png");
    await miniProgram.screenshot({ path: studentShot });
    evidence.push(path.basename(studentShot));

    let submitPage = await miniProgram.navigateTo(`/pages/submit/index?id=${fixture.assignmentId}`);
    const textarea = await submitPage.$("textarea");
    assert.ok(textarea, "未找到作业草稿输入框");
    await textarea.input("__e2e__离线草稿");
    await waitForPageData(submitPage, (data) => data.text === "__e2e__离线草稿", "草稿写入失败");
    submitPage = await miniProgram.reLaunch(`/pages/submit/index?id=${fixture.assignmentId}`);
    const restored = await waitForPageData(submitPage, (data) => data.operationId && data.text === "__e2e__离线草稿", "离线草稿恢复失败");
    assert.match(restored.operationId, /^submission-/);
    const draftShot = path.join(runDir, "offline-draft.png");
    await miniProgram.screenshot({ path: draftShot });
    evidence.push(path.basename(draftShot));

    await resetMiniSession(miniProgram);
    page = await miniProgram.reLaunch("/pages/home/index");
    await page.callMethod("login", { currentTarget: { dataset: { role: "parent" } } });
    await waitForPageData(page, (data) => data.me?.role === "parent" && !data.loading, "家长端模拟器登录超时");
    const portalPage = await miniProgram.switchTab("/pages/portal/index");
    const portalData = await waitForPageData(portalPage, (data) => !data.loading, "家长门户加载超时");
    assert.equal(Number(portalData.studentId), Number(fixture.studentId));
    assert.equal(portalData.error, "");
    const parentShot = path.join(runDir, "parent-portal.png");
    await miniProgram.screenshot({ path: parentShot });
    evidence.push(path.basename(parentShot));

    await resetMiniSession(miniProgram);
    page = await miniProgram.reLaunch("/pages/home/index");
    await page.callMethod("login", { currentTarget: { dataset: { role: "teacher" } } });
    await waitForPageData(page, (data) => data.me?.role === "teacher" && data.me?.teacherLinked === true && !data.loading, "教师端模拟器登录超时");
    const reviewPage = await miniProgram.navigateTo("/pages/review/index");
    const reviewData = await waitForPageData(reviewPage, (data) => !data.loading, "教师批改页加载超时");
    assert.ok(reviewData.assignments.some((item) => item.title === `${E2E_PREFIX}自动化作业`));
    const teacherShot = path.join(runDir, "teacher-review.png");
    await miniProgram.screenshot({ path: teacherShot });
    evidence.push(path.basename(teacherShot));

    if (exceptions.length) throw new Error(`模拟器捕获到异常：${exceptions.join("；")}`);
    stage("开发者工具模拟器", "passed", { summary: "学生、离线草稿、家长门户和教师批改页通过", evidence });
    return evidence;
  } finally {
    if (miniProgram && typeof miniProgram.close === "function") {
      try { await withTimeout(miniProgram.close(), 15000, "关闭模拟器自动化会话"); } catch {
        if (typeof miniProgram.disconnect === "function") miniProgram.disconnect();
      }
      await sleep(1500);
    }
  }
}

async function staticSecurityCheck() {
  const tracked = await runProcess("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { label: "读取 Git 文件列表" });
  const files = tracked.stdout.split(/\r?\n/).filter(Boolean);
  const violations = [];
  for (const relative of files) {
    if (/\.(png|jpe?g|gif|docx|xlsx|pdf|woff2?)$/i.test(relative)) continue;
    const absolute = path.join(ROOT, relative);
    let source = "";
    try { source = await readFile(absolute, "utf8"); } catch { continue; }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) violations.push(`${relative}: 含私钥正文`);
    if (/private\.[A-Za-z0-9_-]+\.key/.test(relative)) violations.push(`${relative}: 上传密钥进入 Git`);
  }
  const project = JSON.parse(await readFile(path.join(MINI_ROOT, "project.config.json"), "utf8"));
  if (project.appid !== "touristappid") violations.push("当前阶段 project.config.json 必须保持 touristappid");
  if (project.projectname !== "满分道法") violations.push("开发者工具工程名未统一为满分道法");
  const app = JSON.parse(await readFile(path.join(MINI_ROOT, "app.json"), "utf8"));
  if (app.window?.navigationBarTitleText !== "满分道法") violations.push("导航栏品牌未统一为满分道法");
  const ignored = await runProcess("git", ["check-ignore", ".dev.vars", ".artifacts/mini/report.json", "private.wx-appid.key"], { label: "Git 忽略规则检查" });
  if (ignored.stdout.trim().split(/\r?\n/).length !== 3) violations.push("本地变量、报告或上传密钥未被完整忽略");
  if (violations.length) throw new Error(`静态安全检查失败：${violations.join("；")}`);
  stage("静态安全检查", "passed", { summary: "未发现私钥正文，测试变量、报告和上传密钥均被 Git 忽略" });
}

async function runChecks() {
  await ensurePreflight();
  await staticSecurityCheck();
  const checks = [
    ["TypeScript", "pnpm", ["typecheck"]],
    ["ESLint", "pnpm", ["lint"]],
    ["自动测试", process.execPath, ["--test", "tests/rendered-html.test.mjs", "tests/core-logic.test.mjs", "tests/mini-integration.test.mjs", "tests/mini-automation.test.mjs"]],
    ["生产构建", "pnpm", ["build"]],
  ];
  for (const [name, program, args] of checks) {
    await runProcess(program, args, { label: name, timeout: 300000 });
    stage(name, "passed");
  }
}

async function runE2E() {
  await ensurePreflight();
  const db = await prepareDatabase();
  const runDir = path.join(ARTIFACT_ROOT, `run-${timestamp()}`);
  await mkdir(runDir, { recursive: true });
  let server;
  try {
    const fixture = await seedFixtures(db);
    server = await startServer();
    await apiRegression(db, fixture);
    await simulatorRegression(runDir, fixture);
    return runDir;
  } finally {
    await stopServer(server);
    await cleanupFixtures(db);
    stage("合成数据清理", "passed", { summary: "仅删除 __e2e__ 数据" });
  }
}

async function openDevTools() {
  await runProcess(DEVTOOLS_CLI, ["open", "--project", MINI_ROOT], { label: "打开微信开发者工具", timeout: 60000 });
  stage("微信开发者工具", "passed", { summary: "已打开满分道法本地项目" });
}

async function runDev() {
  await ensurePreflight();
  await prepareDatabase();
  const server = await startServer({ stream: true });
  await openDevTools();
  if (!server.child) return;
  console.log("满分道法本地联调正在运行；按 Ctrl+C 停止。不会上传或发布。");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.child.kill(signal));
  await new Promise((resolve) => server.child.once("exit", resolve));
}

async function runPreview() {
  const appId = String(process.env.MINI_APP_ID || "").trim();
  const stagingBase = String(process.env.MINI_STAGING_API_BASE || "").trim().replace(/\/$/, "");
  const confirmed = process.env.MINI_PREVIEW_CONFIRMED === "YES_I_CONFIRMED";
  if (!/^wx[a-zA-Z0-9]{16}$/.test(appId) || appId === "touristappid") throw new Error("缺少正式 MINI_APP_ID；当前只能运行模拟器自动化");
  if (!/^https:\/\//.test(stagingBase) || /localhost|127\.0\.0\.1/.test(stagingBase)) throw new Error("MINI_STAGING_API_BASE 必须是独立 HTTPS 测试域名");
  if (!confirmed) throw new Error("生成预览码会把预览包发送到微信；请在获得莫老师当次确认后设置 MINI_PREVIEW_CONFIRMED=YES_I_CONFIRMED");

  await runChecks();
  await runE2E();
  const previewDir = path.join(ARTIFACT_ROOT, `preview-${timestamp()}`);
  const buildDir = path.join(previewDir, "project");
  await mkdir(previewDir, { recursive: true });
  await cp(MINI_ROOT, buildDir, { recursive: true });
  const projectPath = path.join(buildDir, "project.config.json");
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  project.appid = appId;
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  const configPath = path.join(buildDir, "config.js");
  const config = await readFile(configPath, "utf8");
  const replaced = config.replace('develop: "http://localhost:3000"', `develop: ${JSON.stringify(stagingBase)}`);
  if (replaced === config) throw new Error("无法在临时预览副本中注入测试 API 地址");
  await writeFile(configPath, replaced);
  const qr = path.join(previewDir, "preview.png");
  const info = path.join(previewDir, "preview-info.json");
  await runProcess(DEVTOOLS_CLI, ["preview", "--project", buildDir, "--qr-format", "image", "--qr-output", qr, "--info-output", info], { label: "生成微信预览码", timeout: 180000 });
  report.boundaries.previewGenerated = true;
  stage("微信预览码", "passed", { summary: "仅生成预览码，未执行 upload、审核或发布", qr: path.relative(ROOT, qr) });
  await rm(buildDir, { recursive: true, force: true });
  return previewDir;
}

async function writeReport(status, artifactDir = ARTIFACT_ROOT, error = null) {
  await mkdir(artifactDir, { recursive: true });
  report.finishedAt = new Date().toISOString();
  report.status = status;
  if (error) report.error = sanitize(error instanceof Error ? error.message : error);
  const jsonPath = path.join(artifactDir, "report.json");
  const markdownPath = path.join(artifactDir, "report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# 满分道法小程序自动化报告",
    "",
    `- 状态：${status === "passed" ? "通过" : "失败"}`,
    `- 开始：${report.startedAt}`,
    `- 结束：${report.finishedAt}`,
    "- 网站发布：否",
    "- Git 推送：否",
    `- 微信预览码：${report.boundaries.previewGenerated ? "已生成" : "未生成"}`,
    "- 微信上传/审核/发布：否",
    "- 真机验收：未执行",
    "",
    "## 阶段",
    "",
    ...report.stages.map((item) => `- ${item.status === "passed" ? "通过" : item.status === "skipped" ? "跳过" : "失败"}：${item.name}${item.summary ? ` — ${item.summary}` : ""}`),
  ];
  if (report.error) lines.push("", "## 失败原因", "", report.error);
  await writeFile(markdownPath, `${lines.join("\n")}\n`);
  console.log(`报告：${path.relative(ROOT, markdownPath)}`);
}

let artifactDir = ARTIFACT_ROOT;
try {
  if (command === "prepare") {
    await ensurePreflight();
    await prepareDatabase();
  } else if (command === "dev") {
    await runDev();
  } else if (command === "check") {
    await runChecks();
  } else if (command === "e2e") {
    artifactDir = await runE2E();
  } else if (command === "verify") {
    await runChecks();
    artifactDir = await runE2E();
  } else if (command === "preview") {
    artifactDir = await runPreview();
  } else {
    throw new Error(`未知命令：${command}`);
  }
  await writeReport("passed", artifactDir);
} catch (error) {
  const diagnostic = error instanceof Error ? (error.stack || error.message) : error;
  stage("自动化", "failed", { summary: sanitize(diagnostic) });
  await writeReport("failed", artifactDir, diagnostic);
  process.exitCode = 1;
}
