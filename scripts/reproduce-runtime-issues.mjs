import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const marker = "__runtime_repro__";
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
const devVars = path.join(root, ".dev.vars.runtime-repro");
const reportPath = path.join(root, "outputs", "runtime-repro.json");
const serverLogPath = path.join(root, "outputs", "runtime-repro-server.log");
const fullLog = [];
let server;

async function request(url, { cookie, bearer, method = "GET", body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const canHaveBody = !["GET", "HEAD"].includes(method);
  if (canHaveBody && body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: canHaveBody ? (body === undefined ? undefined : JSON.stringify(body)) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 500) }; }
  return { response, data };
}

function databaseHasTeachingTables(file) {
  const candidate = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = candidate
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('lessons','lesson_finance')")
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
      throw new Error(`本地服务提前退出（code ${server.exitCode}）：${fullLog.slice(-10).join("\n")}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地服务启动超时：${fullLog.slice(-10).join("\n")}`);
}

async function main() {
  const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
  if (!database) throw new Error("未找到本地 D1 数据库，请先运行 pnpm dev 初始化");
  const results = [];
  const errors = [];
  const record = (item) => {
    results.push(item);
    console.log(`- ${item.name}: ${item.status} ${JSON.stringify(item.body ?? item.detail ?? "").slice(0, 300)}`);
  };

  await writeFile(devVars, [
    `TEACHER_ADMIN_ACCOUNT=${marker}`,
    `TEACHER_ADMIN_PASSWORD=${password}`,
    `TEACHER_ADMIN_SESSION_SECRET=${sessionSecret}`,
    `DEEPSEEK_AI_ENABLED=false`,
    `WECHAT_TEST_MODE=true`,
    `NODE_ENV=development`,
    ``,
  ].join("\n"), { mode: 0o600 });

  const devServerCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  server = spawn(process.execPath, [devServerCli, "dev"], {
    cwd: root,
    // The Cloudflare Vite plugin loads `.dev.vars.${CLOUDFLARE_ENV}`, so the
    // name must match the file written above or env vars are never applied.
    env: { ...process.env, CLOUDFLARE_ENV: "runtime-repro", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      fullLog.push(text);
      for (const line of text.split(/\r?\n/)) {
        if (/error|Error|constraint|FOREIGN|D1_ERROR|✘|✗|fail/i.test(line)) errors.push(line);
      }
    });
  }
  await waitForServer();

  const login = await request("/api/auth/login", { method: "POST", body: { account: marker, password, returnTo: "/workspace" } });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  record({ name: "teacher login", status: login.response.status, detail: cookie.startsWith("zhishi_teacher_admin=") ? "cookie ok" : "cookie missing" });

  const demoCreate = await request("/api/settings/demo", { cookie, method: "POST", body: {} });
  record({ name: "demo create", status: demoCreate.response.status, body: demoCreate.data });

  for (const url of ["/api/lessons/1", "/api/papers/1"]) {
    const deleted = await request(url, { cookie, method: "DELETE", body: {} });
    record({ name: `DELETE ${url}`, status: deleted.response.status, body: deleted.data });
  }

  const demoCleanup = await request("/api/settings/demo", { cookie, method: "DELETE", body: { confirmation: "清除演示数据" } });
  record({ name: "demo cleanup", status: demoCleanup.response.status, body: demoCleanup.data });

  const miniLogin = await request("/api/mini/login", { method: "POST", body: { role: "teacher", testCode: "runtime-repro" } });
  const token = miniLogin.data?.token || "";
  record({ name: "mini login", status: miniLogin.response.status, detail: token ? `token=${token.slice(0, 8)}…` : JSON.stringify(miniLogin.data) });
  const miniMe = await request("/api/mini/me", { bearer: token });
  record({ name: "mini me before logout", status: miniMe.response.status, body: miniMe.data });
  const miniLogout = await request("/api/mini/logout", { bearer: token, method: "POST", body: {} });
  record({ name: "mini logout", status: miniLogout.response.status, body: miniLogout.data });
  const miniMeAfter = await request("/api/mini/me", { bearer: token });
  record({ name: "mini me after logout", status: miniMeAfter.response.status, body: miniMeAfter.data });

  const sqlite = new DatabaseSync(database, { readOnly: true });
  const counts = {
    miniSessions: sqlite.prepare("SELECT COUNT(*) AS c FROM mini_sessions").get().c,
    wechatAccounts: sqlite.prepare("SELECT COUNT(*) AS c FROM wechat_accounts").get().c,
    demoRecords: sqlite.prepare("SELECT COUNT(*) AS c FROM demo_records").get().c,
    lessons: sqlite.prepare("SELECT COUNT(*) AS c FROM lessons").get().c,
    papers: sqlite.prepare("SELECT COUNT(*) AS c FROM papers").get().c,
  };
  sqlite.close();
  record({ name: "db counts", status: 0, body: counts });

  server.kill("SIGINT");
  await new Promise((resolve) => server.once("exit", resolve));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ results, errors, fullLogTail: fullLog.slice(-200) }, null, 2));
  await writeFile(serverLogPath, fullLog.join(""));
  await rm(devVars, { force: true });
  console.log(`errors matched: ${errors.length}`);
  for (const line of errors.slice(0, 80)) console.log(line);
}

try {
  await main();
} catch (error) {
  console.error(error.stack || String(error));
  try { await writeFile(serverLogPath, fullLog.join("")); } catch {}
  process.exitCode = 1;
}
