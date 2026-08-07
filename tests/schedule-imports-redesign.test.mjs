import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const loadTsModule = async (path) => {
  const source = await read(path);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  new Function("module", "exports", outputText)(evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
};

test("schedule import uses the resilient client and action-specific busy states", async () => {
  const page = await read("app/schedule-imports/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /busyAction/);
  assert.match(page, /finally\s*\{\s*setBusyAction\(""\)/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /\.json\(\)/);
});

test("schedule import protects previews and requires a teacher confirmation", async () => {
  const page = await read("app/schedule-imports/page.tsx");

  assert.match(page, /window\.confirm/);
  assert.match(page, /beforeunload/);
  assert.match(page, /confirmed/);
  assert.match(page, /allowDuplicate/);
  assert.match(page, /重新比较/);
  assert.doesNotMatch(page, /result\.report\.invalid\s*>\s*0/);
});

test("schedule import previews creates, updates, skips, conflicts and new records", async () => {
  const [page, route, preview] = await Promise.all([
    read("app/schedule-imports/page.tsx"),
    read("app/api/schedule-imports/route.ts"),
    read("app/lib/schedule-import-preview.ts"),
  ]);

  for (const action of ["create", "update", "skip", "blocked"]) {
    assert.match(page, new RegExp(action));
    assert.match(preview, new RegExp(`"${action}"`));
  }
  assert.match(page, /studentsToCreate/);
  assert.match(page, /classToCreate/);
  assert.match(route, /inspectScheduleImportRow/);
});

test("schedule confirmation rechecks conflicts before all create-side effects", async () => {
  const [confirm, preview] = await Promise.all([
    read("app/api/schedule-imports/[id]/confirm/route.ts"),
    read("app/lib/schedule-import-preview.ts"),
  ]);

  assert.match(confirm, /inspectScheduleImportRow/);
  assert.match(confirm, /preview\.action === "blocked"/);
  assert.match(confirm, /preview\.action === "skip"/);
  assert.match(confirm, /preview\.action === "update"/);
  assert.match(preview, /status!='cancelled'/);
  assert.match(preview, /start_time<\?/);
  assert.match(preview, /end_time>\?/);
  assert.ok(
    confirm.indexOf("inspectScheduleImportRow") <
      confirm.indexOf("INSERT INTO classes"),
    "conflict and duplicate-name checks must happen before creating classes or students",
  );
});

test("schedule preview blocks new overlaps and names every record it would create", async () => {
  const { inspectScheduleImportRow } = await loadTsModule("app/lib/schedule-import-preview.ts");
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async all() {
          if (sql.includes("FROM students")) return { results: [] };
          return { results: [] };
        },
        async first() {
          if (sql.includes("start_time<?")) return { id: 27, courseName: "高二政治" };
          return null;
        },
      };
    },
  };
  const value = {
    date: "2026-07-30",
    startTime: "18:00",
    endTime: "20:00",
    studentNames: ["小知"],
    className: "",
    courseName: "政治",
    location: "教室",
  };

  const conflict = await inspectScheduleImportRow(db, value, [], new Map());
  assert.equal(conflict.action, "blocked");
  assert.equal(conflict.existingLessonId, 27);
  assert.match(conflict.issues[0], /高二政治/);
  assert.equal(queries.some((sql) => sql.includes("FROM students")), false);

  queries.length = 0;
  db.prepare = (sql) => {
    queries.push(sql);
    return {
      bind() { return this; },
      async all() { return { results: [] }; },
      async first() { return null; },
    };
  };
  const create = await inspectScheduleImportRow(db, value, [], new Map());
  assert.equal(create.action, "create");
  assert.deepEqual(create.studentsToCreate, ["小知"]);
  assert.equal(create.classToCreate, "小知课程");
});

test("schedule import uses shared primitives and readable mobile-first styles", async () => {
  const [layout, page, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/schedule-imports/page.tsx"),
    read("app/schedule-imports.css"),
  ]);

  assert.match(layout, /import "\.\/schedule-imports\.css"/);
  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("schedule import exposes history batches and per-row confirmation results", async () => {
  const [page, listRoute, detailRoute, confirmRoute] = await Promise.all([
    read("app/schedule-imports/page.tsx"),
    read("app/api/schedule-imports/route.ts"),
    read("app/api/schedule-imports/[id]/route.ts"),
    read("app/api/schedule-imports/[id]/confirm/route.ts"),
  ]);

  assert.match(page, /最近导入/);
  assert.match(page, /refreshHistory/);
  assert.match(page, /openHistory/);
  assert.match(page, /\/api\/schedule-imports\/\$\{id\}/);
  assert.match(page, /查看报告/);
  assert.match(page, /查看课时/);
  assert.match(listRoute, /parseStoredJson/);
  assert.match(listRoute, /ORDER BY id DESC LIMIT 30/);
  assert.match(detailRoute, /FROM schedule_imports WHERE id=\?/);
  assert.match(detailRoute, /FROM schedule_import_rows WHERE import_id=\?/);
  assert.match(confirmRoute, /rows: resultRows/);
  assert.match(confirmRoute, /SELECT id,row_number AS rowNumber,action,issue,lesson_id AS lessonId/);
});

test("schedule import fuzzy-matches variant headers and reports unknown columns", async () => {
  const { detectScheduleMappingDetail } = await loadTsModule("app/lib/schedule-import.ts");
  const { mapping, unknownColumns } = detectScheduleMappingDetail([
    "上课时间（周一）",
    "结束 时间",
    "日期（必填）",
    "学生姓名",
    "班级",
    "课程名称",
    "备注说明",
    "序号",
  ]);

  assert.equal(mapping.date, "日期（必填）");
  assert.equal(mapping.startTime, "上课时间（周一）");
  assert.equal(mapping.endTime, "结束 时间");
  assert.equal(mapping.studentNames, "学生姓名");
  assert.equal(mapping.className, "班级");
  assert.equal(mapping.courseName, "课程名称");
  assert.equal(mapping.notes, "备注说明");
  assert.deepEqual(
    unknownColumns.map((column) => column.name),
    ["序号"],
  );
  assert.deepEqual(unknownColumns[0].suggestions, []);

  const typo = detectScheduleMappingDetail(["上课时问", "日期", "结束时间"]);
  assert.equal(typo.mapping.startTime, "上课时问");
  assert.equal(typo.unknownColumns.length, 0);
});

test("schedule import surfaces unknown columns from API to page", async () => {
  const [route, page, css] = await Promise.all([
    read("app/api/schedule-imports/route.ts"),
    read("app/schedule-imports/page.tsx"),
    read("app/schedule-imports.css"),
  ]);

  assert.match(route, /detectScheduleMappingDetail/);
  assert.match(route, /unknownColumns: mappingDetail\.unknownColumns/);
  assert.match(page, /未识别列/);
  assert.match(page, /suggestions/);
  assert.match(page, /该列不会参与导入/);
  assert.match(css, /\.scheduleImportUnknownColumns/);
});

test("schedule retry derives partial, failed and confirmed status from final rows", async () => {
  const { scheduleImportFinalStatus } = await loadTsModule("app/lib/schedule-import-status.ts");

  assert.deepEqual(
    scheduleImportFinalStatus([
      { action: "created", lessonId: 11 },
      { action: "blocked", lessonId: null },
    ]),
    { status: "partial", remaining: 1 },
  );
  assert.deepEqual(
    scheduleImportFinalStatus([{ action: "blocked", lessonId: 3 }]),
    { status: "failed", remaining: 1 },
  );
  assert.deepEqual(
    scheduleImportFinalStatus([
      { action: "created", lessonId: 11 },
      { action: "skipped", lessonId: 12 },
    ]),
    { status: "confirmed", remaining: 0 },
  );
});

test("schedule confirm and page expose retry semantics and parsing progress", async () => {
  const [confirm, page, css] = await Promise.all([
    read("app/api/schedule-imports/[id]/confirm/route.ts"),
    read("app/schedule-imports/page.tsx"),
    read("app/schedule-imports.css"),
  ]);

  assert.match(confirm, /scheduleImportFinalStatus/);
  assert.match(confirm, /\["created", "updated", "skipped"\]/);
  assert.match(confirm, /validateNormalizedSchedule/);
  assert.match(confirm, /confirm_retry/);
  assert.match(page, /重试剩余/);
  assert.match(page, /remainingCount/);
  assert.match(page, /uploadStage/);
  assert.match(page, /正在读取 CSV 行数/);
  assert.match(page, /正在逐行核对现有课时与冲突/);
  assert.match(css, /\.scheduleImportProgressTrack/);
});
