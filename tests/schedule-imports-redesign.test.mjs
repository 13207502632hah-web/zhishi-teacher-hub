import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const cache = new Map();
const requireTs = (absolutePath) => {
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8"), { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }), evaluated = { exports: {} };
  cache.set(absolutePath, evaluated);
  const localRequire = (specifier) => { if (!specifier.startsWith(".")) return require(specifier); const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath))); return requireTs(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`); };
  new Function("module", "exports", "require", outputText)(evaluated, evaluated.exports, localRequire);
  return evaluated.exports;
};
const loadTsModule = (path) => requireTs(fileURLToPath(new URL(`../${path}`, import.meta.url)));

test("V2 schedule intake supports all promised file types and resumable background jobs", async () => {
  const page = await read("app/v2/schedule-imports/ScheduleWorkspace.tsx");
  assert.match(page, /\.xlsx,\.csv,\.png,\.jpg,\.jpeg,\.webp,\.pdf/);
  assert.match(page, /\/api\/v2\/schedule-imports/);
  assert.match(page, /X-Operation-Id/);
  assert.match(page, /setInterval/);
  assert.match(page, /jobAction\("cancel"\)/);
  assert.match(page, /jobAction\("retry"\)/);
  assert.match(page, /重试并从原文件续跑/);
});

test("V2 schedule rows are editable, protected and revalidated", async () => {
  const [page, service] = await Promise.all([read("app/v2/schedule-imports/ScheduleWorkspace.tsx"), read("app/lib/v2/schedule-import-service.ts")]);
  for (const field of ["date", "startTime", "endTime", "studentNames", "className", "courseName", "location"]) assert.match(page, new RegExp(field));
  assert.match(page, /beforeunload/);
  assert.match(page, /未保存/);
  assert.match(page, /state: "skipped"/);
  assert.match(service, /validateNormalizedSchedule/);
  assert.match(service, /inspectScheduleImportRow/);
  assert.match(service, /confidence < \.85/);
});

test("formal schedule writes and undo require explicit confirmation and stable operation ids", async () => {
  const page = await read("app/v2/schedule-imports/ScheduleWorkspace.tsx");
  assert.match(page, /window\.confirm\(`确认后台写入/);
  assert.match(page, /window\.confirm\("确认安全撤销本次导入/);
  assert.match(page, /operationId = crypto\.randomUUID\(\)/);
  assert.match(page, /确认并后台写入/);
  assert.match(page, /安全撤销/);
});

test("mapping, unknown columns and blocked rows remain explainable and downloadable", async () => {
  const [page, service] = await Promise.all([read("app/v2/schedule-imports/ScheduleWorkspace.tsx"), read("app/lib/v2/schedule-import-service.ts")]);
  assert.match(page, /字段识别与错误报告/);
  assert.match(page, /selected\.mapping/);
  assert.match(page, /unknownColumns/);
  assert.match(page, /下载错误报告 CSV/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /\\uFEFF/);
  assert.match(service, /unknownColumns: parsed\.unknownColumns/);
});

test("schedule preview blocks overlaps before create-side effects", async () => {
  const { inspectScheduleImportRow } = loadTsModule("app/lib/schedule-import-preview.ts"), queries = [];
  const db = { prepare(sql) { queries.push(sql); return { bind() { return this; }, async all() { return sql.includes("FROM students") ? { results: [{ id: 8 }] } : { results: [] }; }, async first() { return sql.includes("start_time<?") ? { id: 27, courseName: "高二政治" } : null; } }; } };
  const value = { date: "2026-07-30", startTime: "18:00", endTime: "20:00", studentNames: ["小知"], className: "", courseName: "政治", location: "教室" };
  const conflict = await inspectScheduleImportRow(db, value, [], new Map());
  assert.equal(conflict.action, "blocked"); assert.equal(conflict.existingLessonId, 27); assert.match(conflict.issues[0], /高二政治/); assert.ok(queries.some((sql) => sql.includes("JOIN enrollments e")));
});

test("variant headers and unknown columns stay deterministic", () => {
  const { detectScheduleMappingDetail } = loadTsModule("app/lib/schedule-import.ts"), result = detectScheduleMappingDetail(["上课时间（周一）", "结束 时间", "日期（必填）", "学生姓名", "班级", "课程名称", "备注说明", "序号"]);
  assert.equal(result.mapping.date, "日期（必填）"); assert.equal(result.mapping.startTime, "上课时间（周一）"); assert.equal(result.mapping.endTime, "结束 时间"); assert.equal(result.mapping.studentNames, "学生姓名"); assert.deepEqual(result.unknownColumns.map((item) => item.name), ["序号"]);
  assert.equal(detectScheduleMappingDetail(["上课时问", "日期", "结束时间"]).mapping.startTime, "上课时问");
});

test("V2 confirmation is queued, chunked, recoverable and reconciles finance", async () => {
  const [route, service, dispatch] = await Promise.all([read("app/api/v2/schedule-imports/[id]/confirm/route.ts"), read("app/lib/v2/schedule-import-service.ts"), read("app/lib/v2/background-dispatch.ts")]);
  assert.match(route, /deferV2BackgroundJob/);
  assert.match(route, /status: result\.queued \? 202 : 200/);
  assert.match(service, /type: "schedule-confirm"/);
  assert.match(service, /CONFIRM_CHUNK_SIZE = 50/);
  assert.match(service, /LIMIT \$\{CONFIRM_CHUNK_SIZE\}/);
  assert.match(service, /state: "queued", stage: "writing"/);
  assert.match(service, /reconcileLessonFinance/);
  assert.match(dispatch, /"schedule-confirm"/);
});

test("retired schedule page is removed and navigation uses V2", async () => {
  await assert.rejects(access(new URL("../app/schedule-imports/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/schedule-imports.css", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/schedule-imports/route.ts", import.meta.url)));
  const [layout, navigation, css] = await Promise.all([read("app/layout.tsx"), read("app/components/navigation.ts"), read("app/v2/v2.css")]);
  assert.doesNotMatch(layout, /schedule-imports\.css/);
  assert.match(navigation, /href:\s*"\/v2\/schedule-imports"/);
  assert.doesNotMatch(navigation, /href:\s*"\/schedule-imports"/);
  assert.match(css, /@media\(max-width:720px\)/);
});
