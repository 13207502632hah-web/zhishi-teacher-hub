import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const marker = "__mini_production_guard__";
const devVars = path.join(root, ".dev.vars.mini-production-guard");
const reportPath = path.join(root, "outputs", "mini-production-guard.json");
const logs = [];
let server;
let sqlite;

function databaseHasTeachingTables(file) {
  const candidate = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = candidate
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('lessons','wechat_accounts')")
      .all();
    return tables.length === 2;
  } finally {
    candidate.close();
  }
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      if (databaseHasTeachingTables(full)) return full;
    }
  }
  return null;
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`本地服务提前退出（code ${server.exitCode}）：${logs.slice(-10).join("\n")}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地服务启动超时：${logs.slice(-10).join("\n")}`);
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text: text.slice(0, 300) };
  }
  return { response, data };
}

function snapshot() {
  return sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM wechat_accounts) AS accounts,
      (SELECT COUNT(*) FROM mini_sessions) AS sessions,
      (SELECT COUNT(*) FROM sync_events) AS syncEvents
  `).get();
}

async function main() {
  const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
  assert.ok(database?.includes(`${path.sep}.wrangler${path.sep}state${path.sep}`), "只允许使用项目本地 D1");
  sqlite = new DatabaseSync(database);
  sqlite.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  const before = snapshot();

  await writeFile(devVars, [
    "TEACHER_ADMIN_ACCOUNT=production-guard-check",
    "TEACHER_ADMIN_PASSWORD=production-guard-check",
    "TEACHER_ADMIN_SESSION_SECRET=production-guard-check",
    "WECHAT_TEST_MODE=true",
    "WECHAT_APP_ID=wx_production_guard_check",
    "WECHAT_APP_SECRET=production-guard-check-secret",
    "NODE_ENV=production",
    "CF_PAGES_ENV=production",
    "",
  ].join("\n"), { mode: 0o600 });

  const devServerCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  server = spawn(process.execPath, [devServerCli, "dev"], {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: "mini-production-guard",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => logs.push(String(chunk).trim()));
  }
  await waitForServer();

  const loginTestCode = await request("/api/mini/login", {
    method: "POST",
    body: { role: "teacher", testCode: marker, displayName: "生产守卫测试" },
  });
  const loginFormalCode = await request("/api/mini/login", {
    method: "POST",
    body: { code: "production-guard-formal-code" },
  });
  const sync = await request("/api/mini/sync");
  const me = await request("/api/mini/me");

  for (const [name, result] of [
    ["login testCode", loginTestCode],
    ["login formal code", loginFormalCode],
    ["sync", sync],
    ["me", me],
  ]) {
    assert.equal(result.response.status, 503, `${name} 期望 503，实际 ${result.response.status}：${JSON.stringify(result.data)}`);
    assert.equal(result.data?.code, "MINI_FEATURE_DISABLED", `${name} 缺少统一禁用码：${JSON.stringify(result.data)}`);
  }

  const after = snapshot();
  assert.deepEqual(after, before, "生产守卫下 mini 请求不得产生账号、会话或同步事件");

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({
    ok: true,
    production: {
      NODE_ENV: "production",
      CF_PAGES_ENV: "production",
      WECHAT_TEST_MODE: "true",
      WECHAT_APP_ID: "configured-but-disabled",
    },
    checks: {
      loginTestCode: loginTestCode.response.status,
      loginFormalCode: loginFormalCode.response.status,
      sync: sync.response.status,
      me: me.response.status,
      code: "MINI_FEATURE_DISABLED",
      dataWritten: false,
    },
    before,
    after,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`生产环境 mini 禁用门禁验证通过：login/sync/me 均返回 503 MINI_FEATURE_DISABLED，无数据写入；报告 ${path.relative(root, reportPath)}`);
}

try {
  await main();
} finally {
  try {
    if (sqlite) {
      const like = `test:${marker}%`;
      sqlite.prepare("DELETE FROM mini_sessions WHERE account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE ?)").run(like);
      sqlite.prepare("DELETE FROM wechat_accounts WHERE open_id LIKE ?").run(like);
      sqlite.close();
    }
  } catch {}
  if (server && !server.killed) server.kill("SIGINT");
  await rm(devVars, { force: true });
}
