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
const cloudflareEnv = { env: { DB: null } };
const requireTs = (absolutePath) => {
  if (tsModuleCache.has(absolutePath)) return tsModuleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  tsModuleCache.set(absolutePath, evaluatedModule);
  const localRequire = (specifier) => {
    if (specifier === "cloudflare:workers") return cloudflareEnv;
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
    return requireTs(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`);
  };
  new Function("module", "exports", "require", code)(evaluatedModule, evaluatedModule.exports, localRequire);
  return evaluatedModule.exports;
};
const loadTsModule = (path) =>
  requireTs(fileURLToPath(new URL(`../${path}`, import.meta.url)));

const helpers = sqlite
  ? {
      ...loadTsModule("app/lib/finance-confirm.ts"),
      ...loadTsModule("app/lib/finance-preview.ts"),
    }
  : null;

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

  async run() {
    if (this.db.failComplete && /UPDATE idempotency_operations SET status='completed'/.test(this.sql)) {
      throw new Error("simulated completeOperation failure");
    }
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(info.changes || 0), lastRowId: Number(info.lastInsertRowid || 0) } };
  }
}

class D1Adapter {
  constructor(db) {
    this.db = db;
  }

  prepare(statementSql) {
    return new D1Statement(this.db, statementSql);
  }

  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function setupDatabase() {
  const db = new sqlite(":memory:");
  db.exec(`
    CREATE TABLE lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      course_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
    );
    CREATE TABLE lesson_finance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL UNIQUE,
      payer_type TEXT NOT NULL,
      payer_id INTEGER,
      base_fee REAL NOT NULL DEFAULT 0,
      adjustment REAL NOT NULL DEFAULT 0,
      expected_amount REAL NOT NULL DEFAULT 0,
      received_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'review',
      confirmed_at TEXT,
      confirmed_by INTEGER,
      pricing_rule_id INTEGER,
      calculation_snapshot TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lesson_billing_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_finance_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      attendance_status TEXT NOT NULL DEFAULT 'present',
      billing_factor REAL NOT NULL DEFAULT 1,
      unit_fee REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT,
      UNIQUE(lesson_finance_id, student_id)
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE idempotency_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      result_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idempotency_actor_action_operation_unique ON idempotency_operations (actor_type, actor_id, action, operation_id);
  `);
  const adapter = new D1Adapter(db);
  cloudflareEnv.env.DB = adapter;
  return { db, adapter };
}

const baseInput = (overrides = {}) => ({
  actor: { type: "user", id: 1 },
  lessonId: 100,
  payerType: "institution",
  payerId: 7,
  adjustment: 0,
  adjustmentReason: "",
  calculation: {
    baseFee: 200,
    adjustment: 0,
    expectedAmount: 260,
    items: [{ studentId: 11, status: "present", factor: 1, unitFee: 60, amount: 60, reason: null }],
  },
  ruleId: 5,
  fingerprint: "fp-confirm-1",
  operationId: "op-finance-000001",
  formula: "规则#5：底薪 200 + 学生计费 60 + 调整 0 = 260",
  snapshot: {
    rule: { ruleId: 5 },
    lessonDate: "2026-09-01",
    payerType: "institution",
    payerId: 7,
    attendance: [],
    items: [{ studentId: 11, status: "present", factor: 1, unitFee: 60, amount: 60, reason: null }],
    baseFee: 200,
    adjustment: 0,
    adjustmentReason: "",
    expectedAmount: 260,
    fingerprint: "fp-confirm-1",
    operationId: "op-finance-000001",
    generatedAt: "2026-09-01T00:00:00.000Z",
  },
  ...overrides,
});

const responseJson = async (response) => ({ status: response.status, body: await response.json() });
const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);

test("durable confirm replays exactly once and rejects altered replays", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const input = baseInput();
  const first = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.replayed, false);
  assert.ok(Number.isInteger(first.body.id));

  for (let attempt = 2; attempt <= 10; attempt++) {
    const replay = await responseJson(await helpers.confirmFinanceSettlement(input));
    assert.equal(replay.status, 200, `attempt ${attempt}`);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.id, first.body.id);
  }
  assert.equal(count(db, "lesson_finance"), 1);
  assert.equal(count(db, "lesson_billing_items"), 1);
  assert.equal(count(db, "audit_logs"), 1);

  const alteredLesson = await responseJson(await helpers.confirmFinanceSettlement(baseInput({ lessonId: 101, fingerprint: "fp-other", operationId: input.operationId })));
  assert.equal(alteredLesson.status, 409);
  assert.equal(alteredLesson.body.code, "operation_replay_conflict");

  const alteredPayload = await responseJson(await helpers.confirmFinanceSettlement(baseInput({ fingerprint: "fp-changed" })));
  assert.equal(alteredPayload.status, 409);
  assert.equal(alteredPayload.body.code, "operation_replay_conflict");
  assert.equal(count(db, "lesson_finance"), 1);
});

test("expired preview tokens are rejected", { skip: !sqlite }, async () => {
  setupDatabase();
  cloudflareEnv.env.TEACHER_ADMIN_SESSION_SECRET = "test-preview-secret";
  const created = await helpers.createPreviewToken({
    actorId: 1,
    lessonId: 100,
    payerType: "institution",
    payerId: 7,
    adjustment: 0,
    adjustmentReason: "",
    fingerprint: "fp-preview",
    operationId: "op-finance-000002",
  });
  assert.ok(created, "token must be created when the session secret is configured");
  assert.ok(await helpers.readPreviewToken(created.token));

  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1000;
  try {
    assert.equal(await helpers.readPreviewToken(created.token), null);
  } finally {
    Date.now = realNow;
  }
});

test("legacy confirmed finance keeps already_confirmed without consuming an operation", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  db.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,status,confirmed_at,confirmed_by) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(100, "institution", 7, 200, 0, 260, "pending", "2026-01-01T00:00:00.000Z", 1);
  const result = await responseJson(await helpers.confirmFinanceSettlement(baseInput({ operationId: "op-finance-000003" })));
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "already_confirmed");
  assert.equal(count(db, "lesson_finance"), 1);
  assert.equal(count(db, "idempotency_operations"), 0);
});

test("failed business attempt is abandoned and the same operation retries successfully", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const failedInput = baseInput({
    calculation: {
      baseFee: 200,
      adjustment: 0,
      expectedAmount: 260,
      items: [
        { studentId: 11, status: "present", factor: 1, unitFee: 60, amount: 60, reason: null },
        { studentId: 11, status: "present", factor: 1, unitFee: 60, amount: 60, reason: null },
      ],
    },
  });
  const failed = await responseJson(await helpers.confirmFinanceSettlement(failedInput));
  assert.equal(failed.status, 409);
  assert.equal(count(db, "lesson_finance"), 0);
  assert.equal(count(db, "idempotency_operations"), 0);

  const retried = await responseJson(await helpers.confirmFinanceSettlement(baseInput()));
  assert.equal(retried.status, 200);
  assert.equal(retried.body.replayed, false);
  assert.equal(count(db, "lesson_finance"), 1);
  assert.equal(count(db, "lesson_billing_items"), 1);
  const operation = db.prepare("SELECT status,result_json AS resultJson FROM idempotency_operations WHERE operation_id=?").get("op-finance-000001");
  assert.equal(operation.status, "completed");
  assert.match(operation.resultJson, /"replayed":false/);
});

test("ten concurrent duplicate confirms settle exactly once", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const input = baseInput();
  const responses = await Promise.all(Array.from({ length: 10 }, () => helpers.confirmFinanceSettlement(input).then(responseJson)));
  assert.equal(count(db, "lesson_finance"), 1);
  assert.equal(count(db, "lesson_billing_items"), 1);
  assert.equal(count(db, "idempotency_operations"), 1);
  const successes = responses.filter((item) => item.status === 200);
  assert.ok(successes.length >= 1, "at least one request must complete the settlement");
  for (const item of successes) assert.equal(item.body.id, successes[0].body.id);
  assert.ok(responses.every((item) => item.status === 200 || item.status === 409));
  const replay = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.id, successes[0].body.id);
});

test("adjustment confirmations keep their amount and replay the same snapshot", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const input = baseInput({ adjustment: 50, adjustmentReason: "加课补贴", fingerprint: "fp-adjustment", operationId: "op-finance-000004" });
  input.calculation = { baseFee: 200, adjustment: 50, expectedAmount: 310, items: [{ studentId: 11, status: "present", factor: 1, unitFee: 60, amount: 60, reason: null }] };
  input.snapshot = { ...input.snapshot, adjustment: 50, adjustmentReason: "加课补贴", expectedAmount: 310, fingerprint: "fp-adjustment", operationId: "op-finance-000004" };
  const first = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(first.status, 200);
  const row = db.prepare("SELECT adjustment,expected_amount AS expectedAmount FROM lesson_finance WHERE lesson_id=?").get(100);
  assert.equal(Number(row.adjustment), 50);
  assert.equal(Number(row.expectedAmount), 310);
  const replay = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.snapshot.adjustment, 50);
  assert.equal(replay.body.snapshot.adjustmentReason, "加课补贴");
});

test("stale started operation is reclaimed and confirms exactly once", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const input = baseInput();
  db.prepare("INSERT INTO idempotency_operations(actor_type,actor_id,action,operation_id,status) VALUES(?,?,?,?,?)")
    .run("user", 1, "finance.confirm", input.operationId, "started");
  db.prepare("UPDATE idempotency_operations SET updated_at=datetime('now','-10 minutes') WHERE operation_id=?")
    .run(input.operationId);

  const first = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.ok(Number.isInteger(first.body.id));
  assert.equal(count(db, "lesson_finance"), 1);
  const operation = db.prepare("SELECT status FROM idempotency_operations WHERE operation_id=?").get(input.operationId);
  assert.equal(operation.status, "completed");

  const replay = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(count(db, "lesson_finance"), 1);
});

test("completeOperation failure after commit is recovered by replay", { skip: !sqlite }, async () => {
  const { db } = setupDatabase();
  const input = baseInput();
  db.failComplete = true;

  const first = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.ok(Number.isInteger(first.body.id));
  assert.equal(count(db, "lesson_finance"), 1);
  let operation = db.prepare("SELECT status FROM idempotency_operations WHERE operation_id=?").get(input.operationId);
  assert.equal(operation.status, "started", "business commit survives a failed completion write");

  db.failComplete = false;
  const replay = await responseJson(await helpers.confirmFinanceSettlement(input));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(count(db, "lesson_finance"), 1);
  operation = db.prepare("SELECT status,result_json AS resultJson FROM idempotency_operations WHERE operation_id=?").get(input.operationId);
  assert.equal(operation.status, "completed");
  assert.match(operation.resultJson, /"replayed":true/);
});
