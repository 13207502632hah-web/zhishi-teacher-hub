import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

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

function loadJobService(env) {
  const cache = new Map();
  const load = (absolutePath) => {
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
    const source = readFileSync(absolutePath, "utf8"), { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }), target = { exports: {} };
    cache.set(absolutePath, target);
    const localRequire = (specifier) => {
      if (specifier === "cloudflare:workers") return { env };
      if (!specifier.startsWith(".")) return require(specifier);
      const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
      return load(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`);
    };
    new Function("module", "exports", "require", outputText)(target, target.exports, localRequire);
    return target.exports;
  };
  return load(fileURLToPath(new URL("app/lib/v2/job-service.ts", pathToFileURL(root))));
}

test("D1 background jobs use exclusive leases, bounded retry and immediate queued cancellation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE v2_jobs(
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,type TEXT NOT NULL,entity_type TEXT,entity_id TEXT,
    state TEXT NOT NULL DEFAULT 'queued',stage TEXT NOT NULL DEFAULT 'queued',progress INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,payload_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',checkpoint_json TEXT NOT NULL DEFAULT '{}',error_json TEXT NOT NULL DEFAULT '{}',
    operation_id TEXT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,type,operation_id));
    CREATE TABLE v2_job_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,state TEXT,stage TEXT,progress INTEGER,message TEXT,detail_json TEXT DEFAULT '{}',created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const migration = readFileSync(new URL("../drizzle/0033_v2_background_job_leases.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) sqlite.exec(statement);
  const jobs = loadJobService({ DB: d1Adapter(sqlite) }), access = { id: 7, name: "教师", email: "teacher@example.test", roles: ["teacher"], role: "teacher", authType: "staff" };

  const created = await jobs.createJob(access, { type: "schedule-import", operationId: "op-1", entityId: "import-1", payload: { fileName: "课表.xlsx" } });
  assert.equal(created.job.state, "queued");
  const claim = await jobs.claimBackgroundJob(created.job.id, "worker-a", 60);
  assert.equal(claim.attemptCount, 1);
  assert.equal(await jobs.claimBackgroundJob(created.job.id, "worker-b", 60), null, "active lease must be exclusive");
  const retry = await jobs.requeueBackgroundJob(created.job.id, "temporary provider failure");
  assert.equal(retry.exhausted, false);
  assert.equal(sqlite.prepare("SELECT state FROM v2_jobs WHERE id=?").get(created.job.id).state, "queued");

  sqlite.prepare("UPDATE v2_jobs SET available_at=datetime('now','-1 minute') WHERE id=?").run(created.job.id);
  assert.equal((await jobs.claimBackgroundJob(created.job.id, "worker-c", 60)).attemptCount, 2);
  await jobs.requeueBackgroundJob(created.job.id, "second failure");
  sqlite.prepare("UPDATE v2_jobs SET available_at=datetime('now','-1 minute') WHERE id=?").run(created.job.id);
  assert.equal((await jobs.claimBackgroundJob(created.job.id, "worker-d", 60)).attemptCount, 3);
  assert.equal((await jobs.requeueBackgroundJob(created.job.id, "third failure")).exhausted, true);
  assert.equal(sqlite.prepare("SELECT state FROM v2_jobs WHERE id=?").get(created.job.id).state, "failed");

  const cancelJob = await jobs.createJob(access, { type: "question-import", operationId: "op-cancel" });
  assert.equal(await jobs.requestJobCancel(access, cancelJob.job.id), true);
  const cancelled = sqlite.prepare("SELECT state,cancel_requested AS cancelled FROM v2_jobs WHERE id=?").get(cancelJob.job.id);
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.cancelled, 1);
  sqlite.close();
});
