#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { backup as backupDatabase, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MINI_ROOT = path.join(ROOT, "mini-program");
const DRIZZLE_ROOT = path.join(ROOT, "drizzle");
const D1_ROOT = path.join(ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const ARTIFACT_ROOT = path.join(ROOT, ".artifacts/mini");
const DEV_VARS = path.join(ROOT, ".dev.vars");
const DEFAULT_DEVTOOLS_CLI = process.platform === "win32"
  ? path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Tencent", "微信web开发者工具", "cli.bat")
  : "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const DEVTOOLS_CLI = process.env.WECHAT_DEVTOOLS_CLI || DEFAULT_DEVTOOLS_CLI;
const BASE_URL = "http://localhost:3000";
const E2E_PREFIX = "__e2e__";
const command = process.argv[2] || "verify";

const report = {
  startedAt: new Date().toISOString(),
  command,
  brand: "知师研室 · 学习端",
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
  const allowed = [
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "LANG", "LC_ALL",
    "ComSpec", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT",
  ];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  return {
    ...env,
    CI: "true",
    PNPM_CONFIRM_MODULES_PURGE: "false",
    NODE_ENV: "development",
    WRANGLER_WRITE_LOGS: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    ...extra,
  };
}

function spawnProgram(program, args, options) {
  if (process.platform === "win32" && program === "pnpm") {
    return spawn(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...args], {
      ...options,
      shell: false,
    });
  }
  return spawn(program, args, { ...options, shell: false });
}

function devtoolsCliCommand(args) {
  if (process.platform === "win32" && DEVTOOLS_CLI.toLowerCase().endsWith(".bat")) {
    const devtoolsRoot = path.dirname(DEVTOOLS_CLI);
    return {
      program: path.join(devtoolsRoot, "node.exe"),
      args: [path.join(devtoolsRoot, "cli.js"), ...args],
    };
  }
  return { program: DEVTOOLS_CLI, args };
}

async function runDevtoolsCli(args, options = {}) {
  const command = devtoolsCliCommand(args);
  return runProcess(command.program, command.args, options);
}

async function availablePort(start = 9420) {
  for (let port = start; port < start + 100; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`没有可用的小程序自动化端口（${start}–${start + 99}）`);
}

async function connectAutomator(automator, wsEndpoint, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await withTimeout(automator.connect({ wsEndpoint }), 5000, "连接模拟器");
    } catch (error) {
      lastError = error;
      await sleep(750);
    }
  }
  throw new Error(`微信开发者工具自动化端口未就绪：${sanitize(lastError instanceof Error ? lastError.message : lastError)}`);
}

async function removeDirectoryWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!/(?:EBUSY|EPERM|ENOTEMPTY|resource busy|locked)/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function runProcess(program, args, options = {}) {
  const output = { stdout: "", stderr: "" };
  const child = spawnProgram(program, args, {
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
  let result;
  try { result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); }); }
  finally { clearTimeout(timer); }
  if (result.code !== 0) {
    throw new Error(`${options.label || `${program} ${args.join(" ")}`}失败（${result.code ?? result.signal}）\n${sanitize(output.stderr || output.stdout)}`);
  }
  return output;
}

async function ensurePath(target, mode = fsConstants.F_OK) {
  try { await access(target, mode); return true; } catch { return false; }
}

async function ensurePreflight({ requireDevtools = true } = {}) {
  for (const target of [MINI_ROOT, path.join(MINI_ROOT, "project.config.json"), path.join(ROOT, "package.json")]) {
    if (!await ensurePath(target)) throw new Error(`缺少项目文件：${target}`);
  }
  if (requireDevtools) {
    if (!await ensurePath(DEVTOOLS_CLI, fsConstants.X_OK)) throw new Error(`未找到微信开发者工具 CLI：${DEVTOOLS_CLI}`);
    const cliCommand = devtoolsCliCommand([]);
    for (const target of [cliCommand.program, ...cliCommand.args]) {
      if (!await ensurePath(target, fsConstants.X_OK)) throw new Error(`微信开发者工具 CLI 组件不可用：${target}`);
    }
  }
  await runProcess(process.execPath, ["--version"], { label: "Node 版本检查" });
  await runProcess("pnpm", ["--version"], { label: "pnpm 版本检查" });
  stage("环境预检", "passed", { summary: requireDevtools ? "Node、pnpm、微信开发者工具 CLI 和项目目录均可用" : "Node、pnpm 和小程序项目目录均可用；本轮不调用微信 CLI" });
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
    return { reachable: true, valid: response.status === 200 && /知师研室|来写作业吧/.test(body), status: response.status };
  } catch {
    return { reachable: false, valid: false, status: 0 };
  }
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
  const child = spawnProgram("pnpm", ["dev"], { cwd: ROOT, env: minimalEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(server.child.pid), "/T", "/F"], {
      env: minimalEnv(),
      stdio: "ignore",
      shell: false,
    });
    await new Promise((resolve) => {
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
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

async function initializeDatabaseBinding() {
  try {
    const response = await fetch(`${BASE_URL}/api/v2/mini/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        testCode: "mini-e2e-bootstrap",
        role: "student",
        displayName: "小程序验收初始化",
      }),
      signal: AbortSignal.timeout(5000),
    });
    await response.text();
  } catch {
    // A fresh database has no schema yet, so the bootstrap request may fail
    // after Miniflare creates the local D1 file. The file is checked below.
  }
}

function sqlite(db, sql, label = "本地 D1") {
  const database = new DatabaseSync(db);
  try {
    database.exec(sql);
    return { stdout: "", stderr: "" };
  } catch (error) {
    throw new Error(`${label}失败：${sanitize(error instanceof Error ? error.message : error)}`);
  } finally {
    database.close();
  }
}

function sqliteRows(db, sql) {
  const database = new DatabaseSync(db, { readOnly: true });
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

async function backupLocalDatabase(db, target) {
  const database = new DatabaseSync(db, { readOnly: true });
  try {
    await backupDatabase(database, target);
  } finally {
    database.close();
  }
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
  sqlite(db, await readFile(migration, "utf8"), `应用 ${filename}`);
  applied.push(filename);
}

async function verifySchema(db) {
  const tables = [
    "users", "classes", "students", "assignments", "wechat_accounts", "mini_sessions", "mini_invites",
    "parent_student_links", "mini_bindings", "assignment_targets", "assignment_settings", "idempotency_operations",
    "sync_events", "file_leases", "submission_reviews", "reminder_tasks", "v2_mobile_records", "class_files", "class_notices", "notice_receipts",
  ];
  const missingTables = [];
  for (const table of tables) if (!await hasTable(db, table)) missingTables.push(table);
  const columns = [
    ["assignments", "paper_id"],
    ["assignment_submissions", "review_tags"],
    ["assignments", "class_id"],
    ["assignments", "reminder_rule"],
    ["assignments", "status"],
    ["assignments", "kind"],
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
    await initializeDatabaseBinding();
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
    && await hasColumn(db, "assignments", "paper_id")
    && await hasColumn(db, "assignments", "kind")
    && await hasTable(db, "class_files")
    && await hasTable(db, "class_notices");
  if (running.valid && !schemaReady) throw new Error("本地服务正在使用缺少迁移的 D1；请先停止服务后再运行 mini:prepare");

  await mkdir(path.join(ARTIFACT_ROOT, "backups"), { recursive: true });
  const backup = path.join(ARTIFACT_ROOT, "backups", `local-d1-${timestamp()}.sqlite`);
  await backupLocalDatabase(db, backup);

  if (!await hasTable(db, "users")) {
    const migrations = (await readdir(DRIZZLE_ROOT)).filter((name) => /^00\d\d_.*\.sql$/.test(name)).sort();
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
  if (!await hasTable(db, "v2_mobile_records")) await applyMigration(db, "0030_mobile_records_and_sync.sql", applied);
  if (!await hasColumn(db, "assignments", "kind")) await applyMigration(db, "0034_assignment_learning_modes.sql", applied);
  if (!await hasTable(db, "class_files")) await applyMigration(db, "0035_class_files.sql", applied);
  if (!await hasTable(db, "class_notices")) await applyMigration(db, "0036_class_notices.sql", applied);

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
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await sqlite(db, sql, "清理合成测试数据");
      return;
    } catch (error) {
      lastError = error;
      if (!/(?:disk I\/O|locked|busy)/i.test(error instanceof Error ? error.message : String(error))) throw error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
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
  const response = await jsonRequest("/api/v2/mini/login", { method: "POST", body: JSON.stringify({ testCode, role, displayName: `${E2E_PREFIX}${role}` }) });
  assert.equal(response.status, 200, `${role} 测试登录失败：${response.data.error || response.status}`);
  assert.equal(typeof response.data.token, "string");
  return { ...response.data, headers: { authorization: `Bearer ${response.data.token}` } };
}

async function apiRegression(db, fixture) {
  const results = [];
  const unauthorized = await jsonRequest("/api/v2/mini/me");
  assert.equal(unauthorized.status, 401);
  results.push({ case: "无令牌身份接口", status: 401 });

  const teacherRole = await jsonRequest("/api/v2/mini/login", { method: "POST", body: JSON.stringify({ testCode: `${E2E_PREFIX}teacher`, role: "teacher" }) });
  assert.equal(teacherRole.status, 400);
  results.push({ case: "教师身份入口已移除", status: 400 });

  const unbound = await login("student", `${E2E_PREFIX}unbound`);
  assert.equal(unbound.bindingRequired, true);
  results.push({ case: "未绑定账号", status: 200, bindingRequired: true });

  const student = await login("student");
  const studentAgain = await login("student");
  assert.equal(student.accountId, studentAgain.accountId, "重复登录不应创建重复账号");
  const me = await jsonRequest("/api/v2/mini/me", { headers: student.headers });
  assert.equal(me.status, 200);
  assert.equal(me.data.bindingRequired, false);
  const sync = await jsonRequest("/api/v2/mini/sync?cursor=0", { headers: student.headers });
  assert.equal(sync.status, 200);
  assert.equal(sync.data.full, true);
  assert.ok(sync.data.snapshot.assignments.some((item) => item.title === `${E2E_PREFIX}自动化作业`));
  results.push({ case: "学生登录、身份与完整同步", status: 200 });

  const forbiddenCreate = await jsonRequest("/api/v2/mini/assignments", {
    method: "POST", headers: student.headers,
    body: JSON.stringify({ title: `${E2E_PREFIX}越权作业`, studentIds: [fixture.studentId], operationId: `${E2E_PREFIX}forbidden` }),
  });
  assert.equal(forbiddenCreate.status, 405);
  results.push({ case: "小程序无发布作业方法", status: 405 });

  const submitBody = { action: "submit", assignmentId: fixture.assignmentId, textContent: "__e2e__首次提交", assetIds: [], operationId: `${E2E_PREFIX}submission-v1` };
  const firstSubmit = await jsonRequest("/api/v2/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(submitBody) });
  const repeatedSubmit = await jsonRequest("/api/v2/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(submitBody) });
  assert.equal(firstSubmit.status, 201);
  assert.equal(repeatedSubmit.status, 200);
  assert.deepEqual({ id: repeatedSubmit.data.id, version: repeatedSubmit.data.version }, { id: firstSubmit.data.id, version: firstSubmit.data.version });
  results.push({ case: "学生提交幂等", first: 201, replay: 200, version: firstSubmit.data.version });

  await sqlite(db, `UPDATE assignment_submissions SET status='revision',updated_at=CURRENT_TIMESTAMP WHERE assignment_id=${Number(fixture.assignmentId)} AND student_id=${Number(fixture.studentId)};`, "模拟教师网站确认订正");
  results.push({ case: "教师确认留在网站端", miniTeacherEntry: false });

  const revisionBody = { ...submitBody, textContent: "__e2e__订正版", operationId: `${E2E_PREFIX}submission-v2` };
  const revision = await jsonRequest("/api/v2/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(revisionBody) });
  const revisionAgain = await jsonRequest("/api/v2/mini/submissions", { method: "POST", headers: student.headers, body: JSON.stringify(revisionBody) });
  assert.equal(revision.status, 201);
  assert.equal(revisionAgain.status, 200);
  assert.equal(revision.data.version, 2);
  results.push({ case: "学生订正版本与幂等重放", first: 201, replay: 200, version: 2 });

  const parent = await login("parent");
  const parentMe = await jsonRequest("/api/v2/mini/me", { headers: parent.headers });
  assert.equal(parentMe.status, 200);
  assert.equal(parentMe.data.bindingRequired, false);
  const portal = await jsonRequest(`/api/v2/mini/portal?studentId=${fixture.studentId}`, { headers: parent.headers });
  assert.equal(portal.status, 200);
  results.push({ case: "家长门户", parent: 200 });

  const counts = await sqliteRows(db, `SELECT (SELECT COUNT(*) FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id WHERE s.assignment_id=${Number(fixture.assignmentId)}) AS versions,(SELECT COUNT(*) FROM wechat_accounts WHERE open_id IN ('test:student-preview','test:parent-preview')) AS accounts;`);
  assert.equal(Number(counts[0].versions), 2);
  assert.equal(Number(counts[0].accounts), 2);
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
  let simulatorProject;
  let primaryError;
  let finalizationError;
  const evidence = [];
  try {
    // 正式工程必须开启合法域名校验；本地模拟器回归使用一次性副本关闭校验，
    // 以便访问 localhost。副本位于 Git 忽略的报告目录，不会进入上传包。
    const tempRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
    simulatorProject = path.join(tempRoot, `zhishi-mini-e2e-${timestamp()}`);
    await cp(MINI_ROOT, simulatorProject, { recursive: true });
    const simulatorConfigPath = path.join(simulatorProject, "project.config.json");
    const simulatorConfig = JSON.parse(await readFile(simulatorConfigPath, "utf8"));
    simulatorConfig.setting = { ...(simulatorConfig.setting || {}), urlCheck: false };
    await writeFile(simulatorConfigPath, `${JSON.stringify(simulatorConfig, null, 2)}\n`, "utf8");
    const exceptions = [];
    // 新路径第一次进入 auto 时，开发者工具可能先启动基础库版本未确定的模拟器，
    // 随后才登记 AppID。首次运行时未就绪便关闭并用同一路径重启，第二次会读取正确 SDK。
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const automationPort = await availablePort();
      const cliOutput = await runDevtoolsCli([
        "auto", "--project", simulatorProject,
        "--auto-port", String(automationPort), "--trust-project",
      ], { label: "启动微信开发者工具模拟器", timeout: 90000, inherit: true });
      try {
        miniProgram = await connectAutomator(automator, `ws://127.0.0.1:${automationPort}`);
        miniProgram.on("exception", (error) => exceptions.push(sanitize(JSON.stringify(error))));
        await waitForAutomatorReady(miniProgram, attempt === 1 ? 20000 : 90000);
        break;
      } catch (error) {
        if (attempt === 2) {
          throw new Error(`${error instanceof Error ? error.message : error}\n${sanitize(cliOutput.stderr || cliOutput.stdout)}`);
        }
        if (miniProgram && typeof miniProgram.disconnect === "function") miniProgram.disconnect();
        miniProgram = undefined;
        await runDevtoolsCli(["close", "--project", simulatorProject], { label: "重启首次初始化的模拟器", timeout: 30000, inherit: true });
        await sleep(3000);
      }
    }
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

    if (exceptions.length) throw new Error(`模拟器捕获到异常：${exceptions.join("；")}`);
    stage("开发者工具模拟器", "passed", { summary: "学生首页、离线草稿和家长门户通过；构建中不存在教师页面", evidence });
    return evidence;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (miniProgram && typeof miniProgram.close === "function") {
      try { await withTimeout(miniProgram.close(), 15000, "关闭模拟器自动化会话"); } catch {
        if (typeof miniProgram.disconnect === "function") miniProgram.disconnect();
      }
      await sleep(1500);
    }
    if (simulatorProject) {
      try {
        await runDevtoolsCli(["close", "--project", simulatorProject], { label: "关闭模拟器临时工程", timeout: 30000, inherit: true });
      } catch (closeError) {
        finalizationError = closeError;
      }
      try {
        await removeDirectoryWithRetry(simulatorProject);
      } catch (cleanupError) {
        stage("模拟器临时目录清理", "failed", { summary: sanitize(cleanupError instanceof Error ? cleanupError.message : cleanupError) });
        if (!primaryError) throw cleanupError;
      }
      if (finalizationError && !primaryError) throw finalizationError;
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
  if (project.appid !== "touristappid" && !/^wx[a-zA-Z0-9]{16}$/.test(project.appid)) violations.push("project.config.json 必须使用 touristappid 或格式正确的正式 AppID");
  if (project.appid !== "touristappid" && project.setting?.urlCheck !== true) violations.push("正式 AppID 必须开启服务器域名校验");
  if (project.projectname !== "知师研室学习端") violations.push("开发者工具工程名未统一为知师研室学习端");
  const app = JSON.parse(await readFile(path.join(MINI_ROOT, "app.json"), "utf8"));
  if (app.window?.navigationBarTitleText !== "知师研室 · 学习端") violations.push("导航栏品牌未统一为知师研室 · 学习端");
  const ignored = await runProcess("git", ["check-ignore", ".dev.vars", ".artifacts/mini/report.json", "private.wx-appid.key"], { label: "Git 忽略规则检查" });
  if (ignored.stdout.trim().split(/\r?\n/).length !== 3) violations.push("本地变量、报告或上传密钥未被完整忽略");
  if (violations.length) throw new Error(`静态安全检查失败：${violations.join("；")}`);
  stage("静态安全检查", "passed", { summary: "未发现私钥正文，测试变量、报告和上传密钥均被 Git 忽略" });
}

async function runChecks() {
  await ensurePreflight({ requireDevtools: false });
  await staticSecurityCheck();
  const checks = [
    ["TypeScript", "pnpm", ["typecheck"]],
    ["ESLint", "pnpm", ["lint"]],
    ["自动测试", process.execPath, ["--test", "tests/rendered-html.test.mjs", "tests/core-logic.test.mjs", "tests/mini-integration.test.mjs", "tests/mini-automation.test.mjs", "tests/mini-api-edge.test.mjs"]],
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
  let primaryError;
  try {
    const fixture = await seedFixtures(db);
    server = await startServer();
    await apiRegression(db, fixture);
    await simulatorRegression(runDir, fixture);
    return runDir;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await stopServer(server);
    try {
      await cleanupFixtures(db);
      stage("合成数据清理", "passed", { summary: "仅删除 __e2e__ 数据" });
    } catch (cleanupError) {
      stage("合成数据清理", "failed", { summary: sanitize(cleanupError instanceof Error ? cleanupError.message : cleanupError) });
      if (!primaryError) throw cleanupError;
    }
  }
}

async function openDevTools() {
  await runDevtoolsCli(["open", "--project", MINI_ROOT], { label: "打开微信开发者工具", timeout: 60000 });
  stage("微信开发者工具", "passed", { summary: "已打开知师研室学习端本地项目" });
}

async function runDev() {
  await ensurePreflight();
  await prepareDatabase();
  const server = await startServer({ stream: true });
  await openDevTools();
  if (!server.child) return;
  console.log("知师研室学习端本地联调正在运行；按 Ctrl+C 停止。不会上传或发布。");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.child.kill(signal));
  await new Promise((resolve) => server.child.once("exit", resolve));
}

async function runPreview() {
  const appId = String(process.env.MINI_APP_ID || "").trim();
  const stagingBase = String(process.env.MINI_STAGING_API_BASE || "").trim().replace(/\/$/, "");
  const confirmed = process.env.MINI_PREVIEW_CONFIRMED === "YES_I_CONFIRMED";
  if (!/^wx[a-zA-Z0-9]{16}$/.test(appId) || appId === "touristappid") throw new Error("缺少正式 MINI_APP_ID；当前只能运行模拟器自动化");
  let stagingURL;
  try { stagingURL = new URL(stagingBase); } catch { throw new Error("MINI_STAGING_API_BASE 必须是独立 HTTPS 测试域名"); }
  if (stagingURL.protocol !== "https:" || !stagingURL.hostname || /^(localhost|127\.0\.0\.1)$/.test(stagingURL.hostname) || stagingURL.username || stagingURL.password || stagingURL.search || stagingURL.hash) throw new Error("MINI_STAGING_API_BASE 必须是无账号、查询参数和片段的独立 HTTPS 测试域名");
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
  const replaced = config.replace(/develop:\s*"[^"]+"/, `develop: ${JSON.stringify(stagingBase)}`);
  if (replaced === config) throw new Error("无法在临时预览副本中注入开发环境 API 地址");
  await writeFile(configPath, replaced);
  const releaseTargetPath = path.join(buildDir, "release-target.js");
  await writeFile(releaseTargetPath, `module.exports = Object.freeze({ configured: true, rootDomain: ${JSON.stringify(stagingURL.hostname)}, webOrigin: ${JSON.stringify(stagingBase)}, apiOrigin: ${JSON.stringify(stagingBase)} });\n`);
  const qr = path.join(previewDir, "preview.png");
  const info = path.join(previewDir, "preview-info.json");
  await runDevtoolsCli(["preview", "--project", buildDir, "--qr-format", "image", "--qr-output", qr, "--info-output", info], { label: "生成微信预览码", timeout: 180000 });
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
    "# 知师研室学习端自动化报告",
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
    await ensurePreflight({ requireDevtools: false });
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
