import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("class drive stores private file metadata with idempotent draft creation", async () => {
  const [migration, schema, route] = await Promise.all([read("drizzle/0035_class_files.sql"), read("db/schema.ts"), read("app/api/v2/class-files/route.ts")]);
  for (const marker of ["class_files", "class_id", "asset_id", "operation_id", "class_files_creator_operation_unique", "published_at", "archived_at"]) assert.match(migration, new RegExp(marker));
  assert.match(schema, /export const classFiles/); assert.match(route, /created_by=\? AND operation_id=\?/); assert.match(route, /status: "draft"|,'draft'/); assert.match(route, /private\/class-files/);
  assert.doesNotMatch(route, /status='published'/);
});

test("class drive publishing is approval-gated and emits student-scoped sync events", async () => {
  const [approval, executor, workspace] = await Promise.all([read("app/api/v2/approvals/route.ts"), read("app/lib/v2/approval-executor.ts"), read("app/v2/class-files/ClassFilesWorkspace.tsx")]);
  for (const source of [approval, executor, workspace]) assert.match(source, /class_file\.publish/);
  assert.match(executor, /class_file\.published/); assert.match(executor, /enrollments WHERE class_id=\? AND status='active'/); assert.match(executor, /published_by/);
  assert.match(workspace, /待确认中心/); assert.match(workspace, /window\.confirm/); assert.match(workspace, /api\/v2\/class-files/);
});

test("student and parent class files are enrollment-scoped and every download rechecks authorization", async () => {
  const [list, content, page, app] = await Promise.all([read("app/api/v2/mini/class-files/route.ts"), read("app/api/v2/mini/files/[id]/route.ts"), read("mini-program/pages/class-files/index.js"), read("mini-program/app.json")]);
  assert.match(list, /accessibleStudentIds/); assert.match(list, /e\.student_id=\?/); assert.match(list, /cf\.status='published'/); assert.match(list, /private, no-store/);
  assert.match(content, /class_files cf JOIN enrollments/); assert.match(content, /cf\.status='published'/); assert.match(content, /X-Content-Type-Options/);
  assert.match(page, /api\.download/); assert.match(page, /previewImage/); assert.match(page, /createInnerAudioContext/); assert.match(page, /openDocument/);
  assert.match(app, /pages\/class-files\/index/); assert.match(app, /"text": "资料"/);
});

test("local migration and mobile release checks include class drive", async () => {
  const [initializer, automation, readiness] = await Promise.all([read("scripts/init-local-d1.mjs"), read("scripts/mini-automation.mjs"), read("scripts/mobile-readiness.mjs")]);
  assert.match(initializer, /0035_class_files\.sql/); assert.match(automation, /0035_class_files\.sql/); assert.match(automation, /"class_files"/); assert.match(readiness, /pages\/class-files\/index/);
});
