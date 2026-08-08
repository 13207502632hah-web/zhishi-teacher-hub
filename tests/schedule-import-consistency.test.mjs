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
const requireTs = (absolutePath) => {
  if (tsModuleCache.has(absolutePath)) return tsModuleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  tsModuleCache.set(absolutePath, evaluatedModule);
  const localRequire = (specifier) => {
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
      ...loadTsModule("app/lib/schedule-import-confirm.ts"),
      ...loadTsModule("app/lib/schedule-import-identity.ts"),
      ...loadTsModule("app/lib/schedule-import-preview.ts"),
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

  maybeFailInjected() {
    const raw = this.db;
    if (raw.failWriteSql && this.sql.includes(raw.failWriteSql)) {
      raw.failWriteSql = null;
      throw new Error(raw.failWriteMessage || "注入写入失败");
    }
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  first() {
    this.maybeFailInjected();
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async run() {
    this.maybeFailInjected();
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

const baseRow = () => ({
  date: "2030-01-12",
  startTime: "09:00",
  endTime: "10:30",
  studentNames: ["学生甲"],
  className: "",
  courseName: "政治",
  location: "教室A",
  baseFee: 100,
  perStudentFee: 20,
  institution: "测试机构",
});

function setupDatabase() {
  const db = new sqlite(":memory:");
  db.exec(`
    CREATE TABLE schedule_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      mapping TEXT,
      report TEXT,
      status TEXT NOT NULL DEFAULT 'preview',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE schedule_import_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      row_number INTEGER NOT NULL,
      raw_data TEXT NOT NULL,
      normalized_data TEXT,
      action TEXT NOT NULL DEFAULT 'pending',
      issue TEXT,
      lesson_id INTEGER,
      processing_state TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      source_lineage TEXT,
      source_row_id TEXT,
      source_cell TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER,
      name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      course_type TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grade TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE(class_id, student_id)
    );
    CREATE TABLE lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      mode TEXT NOT NULL DEFAULT 'offline',
      location TEXT,
      course_name TEXT NOT NULL,
      stage TEXT NOT NULL,
      grade TEXT NOT NULL,
      fee REAL,
      fee_status TEXT NOT NULL DEFAULT 'untracked',
      status TEXT NOT NULL DEFAULT 'draft',
      cancellation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lesson_finance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL UNIQUE,
      payer_type TEXT NOT NULL,
      payer_id INTEGER,
      base_fee REAL NOT NULL DEFAULT 0,
      expected_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'review',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      settlement_cycle TEXT NOT NULL DEFAULT 'monthly',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return new D1Adapter(db);
}

async function createImport(db, sourceName = "test.csv") {
  const inserted = await db
    .prepare("INSERT INTO schedule_imports(source_name,fingerprint,status) VALUES(?,?,?) RETURNING id")
    .bind(sourceName, `fingerprint-${Date.now()}`, "preview")
    .first();
  return Number(inserted.id);
}

async function insertRow(db, importId, row, extra = {}) {
  const inserted = await db
    .prepare("INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,source_lineage,source_row_id,source_cell) VALUES(?,?,?,?,?,?,?,?) RETURNING id")
    .bind(
      importId,
      extra.rowNumber || 2,
      JSON.stringify(row),
      JSON.stringify(row),
      extra.action || "pending",
      extra.sourceLineage || "file:test.csv",
      extra.sourceRowId || "tabular-2",
      extra.sourceCell || null,
    )
    .first();
  return Number(inserted.id);
}

async function insertLesson(db, row, classId = null) {
  const inserted = await db
    .prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,fee,fee_status,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
    .bind(
      classId,
      row.date,
      row.startTime,
      row.endTime,
      "offline",
      row.location,
      row.courseName,
      "高中",
      "待补全",
      row.fee || null,
      "untracked",
      "draft",
    )
    .first();
  return Number(inserted.id);
}

async function confirmRowLikeRoute(db, rowId, value, ownerId = 1, options = {}) {
  const row = (await db
    .prepare("SELECT * FROM schedule_import_rows WHERE id=?")
    .bind(rowId)
    .first());
  const linkedLessons = (await db
    .prepare("SELECT lesson_id AS lessonId FROM schedule_import_rows WHERE import_id=? AND lesson_id IS NOT NULL AND (action IN ('created','updated') OR processing_state='needs_reconcile')")
    .bind(Number(row.import_id))
    .all()).results;
  const currentImportLessonIds = new Set(
    linkedLessons.map((item) => Number(item.lessonId)),
  );
  const action = String(row.action || "");
  const state = String(row.processing_state || "");
  if (["created", "updated", "skipped"].includes(action) && state === "done") {
    return { outcome: "done", lessonId: row.lesson_id ? Number(row.lesson_id) : null };
  }
  if (row.lesson_id && action === "skipped") {
    await helpers.markScheduleImportRow(db, rowId, { action: "skipped", state: "done", lessonId: Number(row.lesson_id) });
    return { outcome: "done", lessonId: Number(row.lesson_id) };
  }
  if (row.lesson_id && ["created", "updated"].includes(action) && state !== "done") {
    await helpers.reconcileLessonFinance(db, Number(row.lesson_id), value);
    await helpers.markScheduleImportRow(db, rowId, { action, state: "done", lessonId: Number(row.lesson_id) });
    return { outcome: "done", lessonId: Number(row.lesson_id) };
  }
  if (row.lesson_id && action === "blocked" && state === "needs_reconcile") {
    await helpers.reconcileLessonFinance(db, Number(row.lesson_id), value);
    await helpers.markScheduleImportRow(db, rowId, { action: "created", state: "done", lessonId: Number(row.lesson_id) });
    return { outcome: "done", lessonId: Number(row.lesson_id) };
  }

  const claimed = await helpers.claimScheduleImportRow(db, rowId);
  if (!claimed) {
    await markRowBlocked(db, rowId, "该行正在处理中，请稍后重试", null, "blocked");
    return { outcome: "blocked", lessonId: row.lesson_id ? Number(row.lesson_id) : null };
  }

  const previousByIdentity = await helpers.loadPreviousScheduleIdentities(db);
  const preview = await helpers.inspectScheduleImportRow(
    db,
    value,
    [],
    previousByIdentity,
    {
      ownerId,
      sourceLineage: String(row.source_lineage || ""),
      sourceRowId: String(row.source_row_id || ""),
      currentImportLessonIds,
    },
  );
  if (preview.action === "blocked") {
    await markRowBlocked(db, rowId, preview.issues.join("；"), preview.existingLessonId, "blocked");
    return { outcome: "blocked", lessonId: preview.existingLessonId ? Number(preview.existingLessonId) : null };
  }
  if (preview.action === "skip") {
    await helpers.markScheduleImportRow(db, rowId, {
      action: "skipped",
      state: "done",
      lessonId: preview.existingLessonId,
    });
    return { outcome: "done", lessonId: Number(preview.existingLessonId) };
  }
  if (preview.action === "update" && preview.existingLessonId) {
    return { outcome: "update", lessonId: Number(preview.existingLessonId) };
  }

  const className = value.className ||
    (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
  let classId = null;
  let lessonId = null;
  try {
    if (className) {
      let found = await helpers.findClassId(db, className, ownerId);
      if (!found) {
        const created = await db
          .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
          .bind(ownerId, className, "高中", "待补全", "导入课表", "active")
          .first();
        found = created ? Number(created.id) : null;
      }
      classId = found ? Number(found) : null;
    }
    for (const name of value.studentNames || []) {
      const studentIds = await helpers.findStudentRecords(db, name);
      if (studentIds.length > 1) {
        throw new Error(`学生“${name}”存在同名档案，请人工选择`);
      }
      let studentId = studentIds[0] ?? null;
      if (!studentId) {
        const student = await db
          .prepare("INSERT INTO students(name,grade,status,notes) VALUES(?,?,?,?) RETURNING id")
          .bind(name, "待补全", "active", "由课表导入自动创建，资料待补全")
          .first();
        if (student) studentId = Number(student.id);
      }
      if (classId && studentId) {
        await db
          .prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,?)")
          .bind(classId, studentId, "active")
          .run();
      }
    }
    const lesson = await insertLesson(db, value, classId);
    lessonId = lesson;
    await db
      .prepare("UPDATE schedule_import_rows SET action='created',issue=NULL,lesson_id=?,processing_state='processing' WHERE id=?")
      .bind(lessonId, rowId)
      .run();
    await helpers.reconcileLessonFinance(db, lessonId, value);
    await helpers.markScheduleImportRow(db, rowId, { action: "created", state: "done", lessonId });
    try {
      if (options.audit) await options.audit();
    } catch {
      // audit failure must not roll back already committed business writes
    }
    return { outcome: "done", lessonId };
  } catch (error) {
    await markRowBlocked(
      db,
      rowId,
      error instanceof Error ? error.message : "写入中断",
      lessonId,
      lessonId ? "needs_reconcile" : "failed",
    );
    return { outcome: "blocked", lessonId };
  }
}

async function markRowBlocked(db, rowId, issue, lessonId, state) {
  await db
    .prepare("UPDATE schedule_import_rows SET action='blocked',issue=?,lesson_id=COALESCE(?,lesson_id),processing_state=?,last_error=? WHERE id=?")
    .bind(issue, lessonId, state, issue, rowId)
    .run();
}

const count = (db, table) =>
  Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first().count);

test("schedule import interrupted after lesson insert reconciles without a second lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  const lessonId = await insertLesson(db, row);
  await db
    .prepare("UPDATE schedule_import_rows SET action='created',lesson_id=?,processing_state='processing' WHERE id=?")
    .bind(lessonId, rowId)
    .run();

  const result = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(result.outcome, "done");
  assert.equal(result.lessonId, lessonId);
  assert.equal(count(db, "lessons"), 1);
  assert.equal(count(db, "lesson_finance"), 1);
  const stored = await db.prepare("SELECT action,processing_state,lesson_id AS lessonId FROM schedule_import_rows WHERE id=?").bind(rowId).first();
  assert.equal(stored.action, "created");
  assert.equal(stored.processing_state, "done");
  assert.equal(Number(stored.lessonId), lessonId);
});

test("finance failure preserves the lesson link and a retry reconciles exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  const lessonId = await insertLesson(db, row);
  await db
    .prepare("UPDATE schedule_import_rows SET action='created',lesson_id=?,processing_state='processing' WHERE id=?")
    .bind(lessonId, rowId)
    .run();

  await markRowBlocked(db, rowId, "财务写入中断", lessonId, "needs_reconcile");
  const stored = await db.prepare("SELECT lesson_id AS lessonId FROM schedule_import_rows WHERE id=?").bind(rowId).first();
  assert.equal(Number(stored.lessonId), lessonId);

  const result = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(result.outcome, "done");
  assert.equal(count(db, "lessons"), 1);
  assert.equal(count(db, "lesson_finance"), 1);
});

test("same time and course in another class never maps to the wrong lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const value = baseRow();
  value.date = "2026-09-01";
  value.startTime = "18:00";
  value.endTime = "20:00";
  value.className = "初二1班";
  value.studentNames = [];
  const classRow = await db
    .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
    .bind(1, "初二1班", "初中", "初二", "小班课", "active")
    .first();
  await db
    .prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,status) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(classRow.id, value.date, value.startTime, value.endTime, "offline", value.location, value.courseName, "初中", "初二", "draft")
    .run();

  const second = { ...value, className: "初二2班" };
  await insertRow(db, importId, second);
  const previous = await helpers.loadPreviousScheduleIdentities(db);
  const preview = await helpers.inspectScheduleImportRow(db, second, [], previous, { ownerId: 1 });
  assert.equal(preview.action, "create");
  assert.equal(preview.existingLessonId, null);
  assert.equal(await helpers.findLessonByIdentity(db, second, 1), null);
});

test("one-to-one exact identity requires the full student set", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const a = await db.prepare("INSERT INTO students(name,grade,status) VALUES(?,?,?) RETURNING id").bind("学生甲", "待补全", "active").first();
  const b = await db.prepare("INSERT INTO students(name,grade,status) VALUES(?,?,?) RETURNING id").bind("学生乙", "待补全", "active").first();
  const classRow = await db
    .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
    .bind(1, "学生甲、学生乙课程", "高中", "待补全", "导入课表", "active")
    .first();
  await db.prepare("INSERT INTO enrollments(class_id,student_id,status) VALUES(?,?,?)").bind(classRow.id, a.id, "active").run();
  await db.prepare("INSERT INTO enrollments(class_id,student_id,status) VALUES(?,?,?)").bind(classRow.id, b.id, "active").run();
  const value = baseRow();
  value.studentNames = ["学生甲", "学生乙"];
  await db
    .prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,status) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(classRow.id, value.date, value.startTime, value.endTime, "offline", value.location, value.courseName, "高中", "待补全", "draft")
    .run();

  const previous = await helpers.loadPreviousScheduleIdentities(db);
  const both = await helpers.inspectScheduleImportRow(db, value, [], previous, { ownerId: 1 });
  assert.equal(both.action, "skip");
  assert.equal(both.existingLessonId, 1);
  for (const names of [["学生甲"], ["学生乙"]]) {
    const partial = { ...value, studentNames: names };
    const preview = await helpers.inspectScheduleImportRow(db, partial, [], previous, { ownerId: 1 });
    assert.equal(preview.action, "blocked", `${names.join()} must not reuse the two-student lesson`);
    assert.match(preview.issues[0], /冲突/);
  }
});

test("cross-date lineage updates one lesson and blocks ambiguity", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const oldRow = baseRow();
  oldRow.date = "2026-09-01";
  oldRow.startTime = "18:00";
  oldRow.endTime = "20:00";
  const lessonId = await insertLesson(db, oldRow);
  await insertRow(db, importId, oldRow, {
    action: "created",
    sourceLineage: "file:课表.xlsx",
    sourceRowId: "calendar:C3",
    sourceCell: "C3",
  });
  await db
    .prepare("UPDATE schedule_import_rows SET lesson_id=?,processing_state='done' WHERE import_id=? AND row_number=2")
    .bind(lessonId, importId)
    .run();

  const moved = { ...oldRow, date: "2026-09-03" };
  const preview = await helpers.inspectScheduleImportRow(
    db,
    moved,
    [],
    new Map(),
    { ownerId: 1, sourceLineage: "file:课表.xlsx", sourceRowId: "calendar:C3" },
  );
  assert.equal(preview.action, "update");
  assert.equal(preview.existingLessonId, lessonId);

  const secondLessonId = await insertLesson(db, { ...oldRow, date: "2026-09-02" });
  await insertRow(db, importId, { ...oldRow, date: "2026-09-02" }, {
    rowNumber: 3,
    action: "created",
    sourceLineage: "file:课表.xlsx",
    sourceRowId: "calendar:C3",
    sourceCell: "C3",
  });
  await db
    .prepare("UPDATE schedule_import_rows SET lesson_id=?,processing_state='done' WHERE import_id=? AND row_number=3")
    .bind(secondLessonId, importId)
    .run();
  const ambiguous = await helpers.inspectScheduleImportRow(
    db,
    moved,
    [],
    new Map(),
    { ownerId: 1, sourceLineage: "file:课表.xlsx", sourceRowId: "calendar:C3" },
  );
  assert.equal(ambiguous.action, "blocked");
  assert.match(ambiguous.issues[0], /人工确认/);
});

test("duplicate confirm on one row creates exactly one lesson and finance record", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);

  const first = await confirmRowLikeRoute(db, rowId, row);
  const second = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(first.outcome, "done");
  assert.equal(second.outcome, "done");
  assert.equal(count(db, "lessons"), 1);
  assert.equal(count(db, "lesson_finance"), 1);
  assert.equal(count(db, "enrollments"), 1);
  assert.equal(count(db, "students"), 1);
  assert.equal(count(db, "classes"), 1);
});

test("duplicate student names block preview and confirm consistently", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  await db.prepare("INSERT INTO students(name,grade,status) VALUES(?,?,?)").bind("学生甲", "待补全", "active").run();
  await db.prepare("INSERT INTO students(name,grade,status) VALUES(?,?,?)").bind("学生甲", "待补全", "active").run();
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);

  const previous = await helpers.loadPreviousScheduleIdentities(db);
  const preview = await helpers.inspectScheduleImportRow(db, row, [], previous, { ownerId: 1 });
  assert.equal(preview.action, "blocked");
  assert.match(preview.issues[0], /同名档案/);

  const result = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(result.outcome, "blocked");
  assert.equal(count(db, "lessons"), 0);
  assert.equal(count(db, "students"), 2);
});

test("ten consecutive confirms keep one lesson, finance, enrollment, student and class", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);

  for (let attempt = 1; attempt <= 10; attempt++) {
    const result = await confirmRowLikeRoute(db, rowId, row);
    assert.equal(result.outcome, "done", `attempt ${attempt}`);
  }
  assert.equal(count(db, "lessons"), 1);
  assert.ok(count(db, "lesson_finance") <= 1);
  assert.equal(count(db, "enrollments"), 1);
  assert.equal(count(db, "students"), 1);
  assert.equal(count(db, "classes"), 1);
});

test("blocked conflict links do not become cross-date lineage for the blocked row", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const first = baseRow();
  const firstRowId = await insertRow(db, importId, first, { sourceRowId: "tabular-2" });
  const created = await confirmRowLikeRoute(db, firstRowId, first);
  assert.equal(created.outcome, "done");

  const second = { ...first, startTime: "09:30", endTime: "11:00" };
  const secondRowId = await insertRow(db, importId, second, { sourceRowId: "tabular-3" });
  const blocked = await confirmRowLikeRoute(db, secondRowId, second);
  assert.equal(blocked.outcome, "blocked");
  const blockedRow = await db.prepare("SELECT lesson_id AS lessonId,action FROM schedule_import_rows WHERE id=?").bind(secondRowId).first();
  assert.ok(blockedRow.lessonId, "blocked row should expose the conflicting lesson for the UI");

  const lineage = await helpers.findLineageLessons(db, "file:test.csv", "tabular-3");
  assert.equal(lineage.length, 0, "a blocked conflict link must not be treated as a lesson lineage");
});

test("owner-scoped class lookup never reuses another owner's lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const otherOwner = await db
    .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
    .bind(2, "初二1班", "初中", "初二", "小班课", "active")
    .first();
  const value = baseRow();
  value.date = "2026-09-01";
  value.startTime = "18:00";
  value.endTime = "20:00";
  value.className = "初二1班";
  value.studentNames = [];
  await db
    .prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,status) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(otherOwner.id, value.date, value.startTime, value.endTime, "offline", value.location, value.courseName, "初中", "初二", "draft")
    .run();

  assert.equal(await helpers.findClassId(db, "初二1班", 1), null);
  const previous = await helpers.loadPreviousScheduleIdentities(db);
  const preview = await helpers.inspectScheduleImportRow(db, value, [], previous, { ownerId: 1 });
  assert.equal(preview.action, "create");
  assert.equal(preview.existingLessonId, null);

  const importId = await createImport(db);
  const rowId = await insertRow(db, importId, value);
  const result = await confirmRowLikeRoute(db, rowId, value, 1);
  assert.equal(result.outcome, "done");
  assert.equal(count(db, "lessons"), 2);
  assert.equal(count(db, "classes"), 2);
  const ownClass = await db
    .prepare("SELECT id,owner_id AS ownerId FROM classes WHERE name=? AND owner_id=1")
    .bind("初二1班")
    .first();
  assert.ok(ownClass, "owner 1 must create a class owned by owner 1");
  const ownLesson = await db
    .prepare("SELECT class_id AS classId FROM lessons WHERE id=?")
    .bind(result.lessonId)
    .first();
  assert.equal(Number(ownLesson.classId), Number(ownClass.id));
});

async function storedRow(db, rowId) {
  return db
    .prepare("SELECT action,processing_state AS state,lesson_id AS lessonId FROM schedule_import_rows WHERE id=?")
    .bind(rowId)
    .first();
}

async function failedWriteRetriesOnce(db, rowId, row, sqlFragment) {
  db.db.failWriteSql = sqlFragment;
  const first = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(first.outcome, "blocked", `${sqlFragment} must block the first confirm`);
  const state = await storedRow(db, rowId);
  assert.equal(state.action, "blocked");
  const hadLesson = Boolean(state.lessonId);
  assert.equal(state.state, hadLesson ? "needs_reconcile" : "failed");
  assert.equal(count(db, "lessons"), hadLesson ? 1 : 0);

  const second = await confirmRowLikeRoute(db, rowId, row);
  assert.equal(second.outcome, "done", `${sqlFragment} retry must finish`);
  assert.equal(count(db, "lessons"), 1);
  assert.equal(count(db, "lesson_finance"), 1);
  assert.deepEqual(
    {
      classes: count(db, "classes"),
      students: count(db, "students"),
      enrollments: count(db, "enrollments"),
    },
    { classes: 1, students: 1, enrollments: 1 },
    `${sqlFragment} retry must create one class, one student and one enrollment`,
  );
  const done = await storedRow(db, rowId);
  assert.equal(done.action, "created");
  assert.equal(done.state, "done");
  assert.ok(done.lessonId);
}

test("class create failure never leaves an orphan lesson and retries exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "INSERT INTO classes");
});

test("student create failure never leaves an orphan lesson and retries exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "INSERT INTO students");
});

test("enrollment failure never leaves an orphan lesson and retries exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "INSERT OR IGNORE INTO enrollments");
});

test("lesson insert failure never creates a partial lesson and retries exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "INSERT INTO lessons");
});

test("row link update failure after lesson insert reconciles without a second lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "UPDATE schedule_import_rows SET action='created'");
});

test("finance write failure after lesson insert reconciles without a second lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "INSERT OR IGNORE INTO lesson_finance");
});

test("final row mark failure keeps the lesson link and a retry completes exactly once", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  await failedWriteRetriesOnce(db, rowId, row, "SET action=?,issue=?,lesson_id=COALESCE");
});

test("audit failure after commit does not roll back the created lesson", { skip: !sqlite }, async () => {
  const db = setupDatabase();
  const importId = await createImport(db);
  const row = baseRow();
  const rowId = await insertRow(db, importId, row);
  const result = await confirmRowLikeRoute(db, rowId, row, 1, {
    audit: async () => {
      throw new Error("审计写入中断");
    },
  });
  assert.equal(result.outcome, "done");
  assert.equal(count(db, "lessons"), 1);
  assert.equal(count(db, "lesson_finance"), 1);
  const state = await storedRow(db, rowId);
  assert.equal(state.action, "created");
  assert.equal(state.state, "done");
});
