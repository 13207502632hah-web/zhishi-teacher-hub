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
