import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
const require = createRequire(import.meta.url), ts = require("typescript");
const modules = new Map();
function load(relative) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  if (modules.has(filename)) return modules.get(filename);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("module", "exports", "require", compiled)(result, result.exports, (specifier) => load(new URL(`${specifier}.ts`, new URL(relative, import.meta.url)).href));
  modules.set(filename, result.exports); return result.exports;
}
const { weeklyDates, calendarWeekDates } = load("../app/lib/weekly-schedule.ts");
const { planWeeklySchedule, commitWeeklySchedule, listWeeklySchedules } = load("../app/lib/services/weekly-schedule-service.ts");
const access = { id: 1, role: "teacher", roles: ["teacher"], name: "演练教师" };
const input = { kind: "create", startDate: "2026-09-01", endDate: "2026-09-30", weekday: 6, courseName: "周六道法", classId: "", stage: "初中", grade: "九年级", startTime: "09:00", endTime: "11:00", location: "教室A", topic: "宪法" };
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE classes(id INTEGER PRIMARY KEY,owner_id INTEGER,status TEXT,name TEXT); INSERT INTO classes VALUES(1,1,'active','初三班');
    CREATE TABLE staff_class_access(user_id INTEGER,class_id INTEGER);
    CREATE TABLE lessons(id INTEGER PRIMARY KEY AUTOINCREMENT,class_id INTEGER,date TEXT NOT NULL,start_time TEXT,end_time TEXT,course_name TEXT,stage TEXT,grade TEXT,location TEXT,topic TEXT,status TEXT,cancellation_reason TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE lesson_finance(lesson_id INTEGER,confirmed_at TEXT,received_amount REAL);
    CREATE TABLE audit_logs(user_id INTEGER,action TEXT,entity_type TEXT,entity_id TEXT,detail TEXT);`);
  sql.exec(readFileSync(new URL("../drizzle/0038_weekly_schedules.sql", import.meta.url), "utf8"));
  const db = {
    beforeBatch: null,
    prepare(query) { return { bind(...args) { return { query, args, first: async () => sql.prepare(query).get(...args) || null, all: async () => ({ results: sql.prepare(query).all(...args) }) }; } }; },
    async batch(statements) {
      if (db.beforeBatch) { db.beforeBatch(); db.beforeBatch = null; }
      sql.exec("BEGIN");
      try { const result = statements.map((s) => ({ results: sql.prepare(s.query).all(...s.args) })); sql.exec("COMMIT"); return result; }
      catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
  };
  return { sql, db, async save(body = input, who = access) { const plan = await planWeeklySchedule(db, who, body); return commitWeeklySchedule(db, who, { ...body, previewToken: plan.token, operationId: crypto.randomUUID() }); } };
}
test("weekly dates include boundaries and cross months/years/leap days", () => {
  assert.deepEqual(calendarWeekDates("2026-09-30"), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(calendarWeekDates(""), []);
  assert.deepEqual(weeklyDates("2026-09-01", "2026-09-30", 6), ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"]);
  assert.deepEqual(weeklyDates("2024-02-29", "2024-03-07", 4), ["2024-02-29", "2024-03-07"]);
  assert.deepEqual(weeklyDates("2026-12-31", "2027-01-07", 4), ["2026-12-31", "2027-01-07"]);
  for (const dates of [["2026-02-30","2026-03-10",1],["2026-09-02","2026-09-01",1],["2026-09-01","2026-09-02",6],["2026-09-01","2030-01-01",1]]) assert.throws(() => weeklyDates(...dates));
});

test("weekly schedule storage participates in backup and explicit workspace cleanup", () => {
  const backup = readFileSync(new URL("../app/api/v2/settings/export/route.ts", import.meta.url), "utf8");
  const cleanup = readFileSync(new URL("../app/api/v2/settings/data/route.ts", import.meta.url), "utf8");
  for (const table of ["lesson_series", "lesson_occurrences", "lesson_series_operations"]) {
    assert.ok(backup.includes(`"${table}"`));
    assert.ok(cleanup.includes(`"${table}"`));
  }
  assert.ok(cleanup.indexOf('"lesson_occurrences"') < cleanup.indexOf('"lesson_series"'));
  assert.ok(cleanup.indexOf('"lesson_occurrences"') < cleanup.indexOf('"lessons"'));
});
test("create materializes linked lessons, retains repeat receipt and rejects reuse with changed payload", async () => {
  const { sql, db } = fixture();
  const plan = await planWeeklySchedule(db, access, input), body = { ...input, previewToken: plan.token, operationId: crypto.randomUUID() };
  const created = await commitWeeklySchedule(db, access, body);
  assert.equal(created.count, 4);
  assert.equal((await commitWeeklySchedule(db, access, body)).repeated, true);
  assert.equal(sql.prepare("SELECT count(*) n FROM lessons").get().n, 4);
  assert.equal(sql.prepare("SELECT count(*) n FROM lesson_occurrences o JOIN lessons l ON l.id=o.lesson_id WHERE l.date=o.original_date").get().n, 4);
  assert.equal(sql.prepare("SELECT count(*) n FROM audit_logs").get().n, 1);
  await assert.rejects(commitWeeklySchedule(db, access, { ...body, courseName: "变更" }), /另一项修改/);
  await assert.rejects(commitWeeklySchedule(db, access, { ...input, operationId: crypto.randomUUID(), previewToken: plan.token }), /冲突/);
  sql.close();
});
test("single exception stays independent and following edit preserves completed and exception lessons", async () => {
  const f = fixture(); await f.save();
  const one = { kind: "change", lessonId: 3, scope: "single", action: "reschedule", reason: "校内活动", date: "2026-09-20", startTime: "13:00", endTime: "15:00", courseName: "单次改课", location: "教室B", topic: "法治" };
  await f.save(one);
  f.sql.prepare("UPDATE lessons SET status='completed' WHERE id=4").run();
  const following = { ...one, lessonId: 1, scope: "following", date: "2026-09-06", courseName: "固定周日班" };
  const p = await planWeeklySchedule(f.db, access, following);
  assert.deepEqual(p.slots.map((r) => r.date), ["2026-09-06", "2026-09-13"]);
  assert.equal(p.skipped.length, 2); await f.save(following);
  assert.deepEqual(f.sql.prepare("SELECT id,date,course_name FROM lessons WHERE id=3").get(), Object.assign(Object.create(null), { id:3,date:"2026-09-20",course_name:"单次改课" }));
  assert.equal(f.sql.prepare("SELECT date FROM lessons WHERE id=4").get().date, "2026-09-26");
  assert.equal(f.sql.prepare("SELECT original_date FROM lesson_occurrences WHERE lesson_id=1").get().original_date, "2026-09-05");
  await f.save({ ...one, lessonId:2, action:"cancel", reason:"国庆停课" });
  assert.equal(f.sql.prepare("SELECT status FROM lessons WHERE id=2").get().status, "cancelled");
  assert.equal(f.sql.prepare("SELECT count(*) n FROM lessons").get().n, 4);
  f.sql.close();
});
test("preview is invalidated by edits; database guard rejects conflicts introduced after preview checks", async () => {
  const f = fixture(), plan = await planWeeklySchedule(f.db, access, input);
  f.db.beforeBatch = () => f.sql.prepare("INSERT INTO lessons(date,start_time,end_time,course_name,status) VALUES('2026-09-19','10:00','12:00','刚新增的课','scheduled')").run();
  await assert.rejects(commitWeeklySchedule(f.db, access, { ...input, operationId:crypto.randomUUID(), previewToken:plan.token }), /全部撤回/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM lesson_series").get().n, 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM lesson_series_operations").get().n, 0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM lessons").get().n, 1);
  f.sql.close();
});
test("partial insert failure rolls back receipts, lessons, mappings and series", async () => {
  const f=fixture();
  f.sql.exec("CREATE TRIGGER test_failure BEFORE INSERT ON lessons WHEN NEW.date='2026-09-19' BEGIN SELECT RAISE(ABORT,'test insertion failure'); END;");
  await assert.rejects(f.save(), /test insertion failure/);
  for(const table of ['lesson_series_operations','lessons','lesson_occurrences','lesson_series','audit_logs']) assert.equal(f.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  f.sql.close();
});
test("private ownership, class permission, financial locks and stale previews are enforced", async () => {
  const f=fixture(); await f.save();
  const change={kind:"change",lessonId:1,scope:"single",action:"reschedule",reason:"时间调整",date:"2026-09-06",startTime:"09:00",endTime:"11:00",courseName:"道法",location:"",topic:""};
  await assert.rejects(f.save(change,{...access,id:2}), /无权/);
  const foreign=await listWeeklySchedules(f.db,{...access,id:2},f.sql.prepare("SELECT id FROM lesson_series").get().id);
  assert.equal(foreign.lessons.length,0);
  await assert.rejects(f.save({...input,classId:1},{...access,id:2,role:"assistant"}), /无权/);
  const plan=await planWeeklySchedule(f.db,access,change);
  f.sql.exec("UPDATE lessons SET topic='备课修改' WHERE id=1");
  await assert.rejects(commitWeeklySchedule(f.db,access,{...change,operationId:crypto.randomUUID(),previewToken:plan.token}), /重新预览/);
  f.sql.exec("INSERT INTO lesson_finance VALUES(1,'2026-09-01',100)");
  await assert.rejects(f.save(change), /收款确认/);
  f.sql.close();
});
