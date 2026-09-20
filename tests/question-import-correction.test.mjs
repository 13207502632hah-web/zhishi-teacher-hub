import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url), ts = require("typescript");
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE questions(id INTEGER PRIMARY KEY,question_set_id INTEGER,stem TEXT,material TEXT,options TEXT,answer TEXT,answer_points TEXT,analysis TEXT,knowledge_points TEXT,stage TEXT,grade TEXT,score REAL,year INTEGER,region TEXT,notes TEXT,fingerprint TEXT,reviewed INTEGER DEFAULT 0,review_status TEXT DEFAULT 'auto_checked',created_at TEXT DEFAULT '2026-09-20 09:37:30',updated_at TEXT DEFAULT '2026-09-20 09:37:30');
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity_type TEXT,entity_id TEXT,detail TEXT);
    CREATE TABLE idempotency_operations(actor_type TEXT,actor_id INTEGER,action TEXT,operation_id TEXT,status TEXT,result_json TEXT,expires_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(actor_type,actor_id,action,operation_id));
    INSERT INTO questions(id,question_set_id,stem,material,notes) VALUES(1,74,'（题目未完，待续）','前三座桥','原题号：30'),(2,75,'其他卷','内容','原题号：1'),(3,74,'已修改的题','内容','原题号：31'),(4,74,'已确认的题','内容','原题号：32');
    UPDATE questions SET updated_at='2026-09-20T09:40:00.000Z' WHERE id=3;
    UPDATE questions SET reviewed=1 WHERE id=4;`);
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return db.prepare(this.sql).get(...this.values) || null; }
    async run() { return { meta: { changes: Number(db.prepare(this.sql).run(...this.values).changes) } }; }
  }
  const env = { DB: { prepare: (sql) => new Statement(sql), batch: async (statements) => { db.exec("BEGIN"); try { const output = []; for (const statement of statements) output.push(await statement.run()); db.exec("COMMIT"); return output; } catch (error) { db.exec("ROLLBACK"); throw error; } } } };
  const vectorCalls = [], cache = new Map();
  const load = (path) => {
    if (cache.has(path)) return cache.get(path).exports;
    const loaded = { exports: {} }; cache.set(path, loaded);
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    new Function("module", "exports", "require", outputText)(loaded, loaded.exports, (name) => {
      if (name === "cloudflare:workers") return { env };
      if (name === "./vector-index") return { ensureLocalQuestionVectors: async (rows) => { vectorCalls.push(rows); } };
      return name.startsWith(".") ? load(fileURLToPath(new URL(`${name}.ts`, pathToFileURL(path)))) : require(name);
    });
    return loaded.exports;
  };
  const api = load(fileURLToPath(new URL("../app/lib/v2/question-import-correction.ts", import.meta.url)));
  return { db, api, vectorCalls };
}
const access = { id: 7, role: "teacher" };
const correction = (id = 1) => ({ id, expectedUpdatedAt: "2026-09-20 09:37:30", sourcePages: [7, 8], changes: { stem: "结合材料，谈谈这些桥蕴含哪些道理。", material: "前三座桥\n第四座桥", score: 8 } });

test("source-backed import corrections preserve identity, audit before/after, rebuild search and replay once", async () => {
  const { db, api, vectorCalls } = setup();
  const first = await api.correctQuestionImport(access, "job-fixture", 74, "correct-operation-1", [correction()]);
  assert.equal(first.status, 200); assert.deepEqual((await first.json()).updated, [1]);
  const row = db.prepare("SELECT * FROM questions WHERE id=1").get();
  assert.equal(row.stem, correction().changes.stem); assert.equal(row.score, 8); assert.equal(row.question_set_id, 74); assert.equal(row.notes, "原题号：30"); assert.ok(row.fingerprint);
  const detail = JSON.parse(db.prepare("SELECT detail FROM audit_logs").get().detail);
  assert.equal(detail.before.stem, "（题目未完，待续）"); assert.equal(detail.after.stem, correction().changes.stem); assert.deepEqual(detail.sourcePages, [7, 8]);
  assert.equal(vectorCalls[0][0].id, 1);
  const replay = await api.correctQuestionImport(access, "job-fixture", 74, "correct-operation-1", [correction()]);
  assert.equal((await replay.json()).repeated, true); assert.equal(db.prepare("SELECT count(*) n FROM audit_logs").get().n, 1);
  const different = { ...correction(), changes: { stem: "不同内容" } };
  assert.equal((await api.correctQuestionImport(access, "job-fixture", 74, "correct-operation-1", [different])).status, 409);
  db.close();
});

test("correction cannot overwrite teacher edits, reviews, other imports or role fields", async () => {
  const { db, api } = setup();
  for (const id of [2, 3, 4]) assert.equal((await api.correctQuestionImport(access, "job-fixture", 74, `reject-operation-${id}`, [correction(id)])).status, 409);
  assert.equal((await api.correctQuestionImport(access, "job-fixture", 74, "reject-bad-field", [{ ...correction(), changes: { reviewed: 1 } }])).status, 422);
  assert.equal((await api.correctQuestionImport(access, "job-fixture", 74, "reject-no-source", [{ ...correction(), sourcePages: [] }])).status, 422);
  assert.equal((await api.correctQuestionImport(access, "job-fixture", 74, "reject-no-number", [{ ...correction(), changes: { notes: "抹去原题号" } }])).status, 422);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs").get().n, 0);
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id=1").get().stem, "（题目未完，待续）");
  db.close();
});
