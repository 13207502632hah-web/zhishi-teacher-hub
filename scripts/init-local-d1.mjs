#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const d1Root = path.join(root, ".wrangler", "state", "v3", "d1");
const drizzleRoot = path.join(root, "drizzle");
const requiredTables = ["users", "lessons", "papers", "demo_records", "ai_question_review_tasks"];

function databaseHasRequiredTables(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN (?, ?, ?, ?, ?)")
      .all(...requiredTables);
    return rows.length === requiredTables.length;
  } finally {
    db.close();
  }
}

async function findDatabase(directory = d1Root) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      try {
        if (databaseHasRequiredTables(full)) return full;
      } catch {
        // Miniflare may leave a locked or half-created file; keep searching.
      }
    }
  }
  return null;
}

async function findAnySqlite(directory = d1Root) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findAnySqlite(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      return full;
    }
  }
  return null;
}

async function applyMigrationFile(db, file) {
  const content = await readFile(file, "utf8");
  const statements = content.split(/--> statement-breakpoint/);
  for (const statement of statements) {
    const sql = statement.trim();
    if (sql) db.exec(sql);
  }
}

async function applyAllMigrations(database) {
  const files = (await readdir(drizzleRoot)).filter((name) => /^00\d\d_.*\.sql$/.test(name)).sort();
  const db = new DatabaseSync(database);
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    for (const file of files) await applyMigrationFile(db, path.join(drizzleRoot, file));
    db.exec("PRAGMA foreign_keys=ON;");
  } finally {
    db.close();
  }
}

async function waitForDatabaseFile(child, logs, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`本地服务提前退出（code ${child.exitCode}）：${logs.slice(-8).join("\n")}`);
    }
    const database = await findAnySqlite();
    if (database) return database;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等待本地 D1 文件超时：${logs.slice(-8).join("\n")}`);
}

async function requestPublicDbRoute(child, logs, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`本地服务提前退出（code ${child.exitCode}）：${logs.slice(-8).join("\n")}`);
    }
    try {
      // 日历订阅路由无需登录即读取 D1；首次真实访问会让 Miniflare 在本地落盘数据库。
      // 未迁移的库会先返回 500；只要请求真正到达路由并触达 D1 即视为成功。
      const response = await fetch("http://127.0.0.1:3000/api/calendar/feed/d1-init-token");
      if (response.ok || response.status === 404 || response.status === 500) return;
    } catch {
      // 服务尚未就绪，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`触发本地 D1 创建超时：${logs.slice(-8).join("\n")}`);
}

async function startServerToCreateDatabase() {
  const cli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  const logs = [];
  const child = spawn(process.execPath, [cli, "dev"], {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: "d1-init",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
      PORT: "3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      logs.push(text.trim());
      if (logs.length > 200) logs.splice(0, logs.length - 200);
    });
  }
  try {
    await requestPublicDbRoute(child, logs);
    return await waitForDatabaseFile(child, logs);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
}

const existing = await findDatabase();
if (existing) {
  console.log(`本地 D1 已就绪：${path.relative(root, existing)}`);
} else {
  let database = await findAnySqlite();
  if (!database) database = await startServerToCreateDatabase();
  if (!database || !database.startsWith(d1Root)) throw new Error("未找到项目目录内的 Miniflare D1；拒绝操作远程数据库");
  await applyAllMigrations(database);
  if (!databaseHasRequiredTables(database)) {
    throw new Error("迁移应用后本地 D1 仍缺少必需表，请检查 drizzle 迁移顺序");
  }
  console.log(`本地 D1 初始化完成：${path.relative(root, database)}`);
}
