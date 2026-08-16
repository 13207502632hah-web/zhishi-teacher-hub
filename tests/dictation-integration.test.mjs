import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("dictation migration extends the shared assignment lifecycle without a duplicate submission model", async () => {
  const [migration, schema, service] = await Promise.all([read("drizzle/0034_assignment_learning_modes.sql"), read("db/schema.ts"), read("app/lib/services/assignment-service.ts")]);
  for (const field of ["kind", "content_json", "assignments_kind_status_updated_idx"]) assert.match(migration, new RegExp(field));
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/);
  assert.match(schema, /kind: text\("kind"\)/); assert.match(schema, /contentJson: text\("content_json"\)/);
  for (const kind of ["homework", "dictation", "follow_reading"]) assert.match(service, new RegExp(kind));
  for (const table of ["assignment_targets", "assignment_submissions", "assignment_assets", "assignment_settings"]) assert.match(service, new RegExp(table));
});

test("teacher dictation workspace only creates drafts and publishes through approval", async () => {
  const [route, page, workspace, shell] = await Promise.all([read("app/api/v2/dictations/route.ts"), read("app/v2/dictations/page.tsx"), read("app/v2/dictations/DictationWorkspace.tsx"), read("app/v2/V2Shell.tsx")]);
  assert.match(route, /requirePermission\("lessons:write"\)/); assert.match(route, /requireClassAccess/); assert.match(route, /status: "draft"/); assert.match(route, /audit/);
  assert.match(page, /跟读与听写/); assert.match(shell, /\/v2\/dictations/);
  assert.match(workspace, /assignment\.publish/); assert.match(workspace, /待确认中心/); assert.match(workspace, /\/api\/v2\/assignments\/files/);
  assert.doesNotMatch(route + workspace, /status: "published"|UPDATE assignments SET status='published'/);
});

test("student and parent mini route scopes children and never leaks dictation answers", async () => {
  const [route, assignments, sync, service, app, page, submit, portal] = await Promise.all([
    read("app/api/v2/mini/dictations/route.ts"), read("app/api/v2/mini/assignments/route.ts"), read("app/api/v2/mini/sync/route.ts"), read("app/lib/services/assignment-service.ts"),
    read("mini-program/app.json"), read("mini-program/pages/dictation/index.js"), read("mini-program/pages/submit/index.js"), read("mini-program/pages/portal/index.js"),
  ]);
  assert.match(route, /requireMini/); assert.match(route, /itemCount/); assert.match(route, /item\.kind === "follow_reading" \? contentItems : \[\]/);
  assert.match(assignments, /filters\.set\("kind", "homework"\)/); assert.match(sync, /kind: "homework"/);
  assert.match(service, /requestedStudentId/); assert.match(service, /ids\.includes/); assert.match(service, /a\.status!='draft'/);
  assert.match(app, /pages\/dictation\/index/); assert.match(page, /\/api\/v2\/mini\/dictations/); assert.match(page, /createInnerAudioContext/); assert.match(page, /pages\/submit\/index/);
  assert.match(submit, /submission-draft-/); assert.match(submit, /getRecorderManager/); assert.match(submit, /operationId/);
  assert.doesNotMatch(portal, /me\.role === "teacher"/);
});

test("local database and mini verification include the learning-mode migration", async () => {
  const [initializer, automation, readiness] = await Promise.all([read("scripts/init-local-d1.mjs"), read("scripts/mini-automation.mjs"), read("scripts/mobile-readiness.mjs")]);
  assert.match(initializer, /0034_assignment_learning_modes\.sql/); assert.match(initializer, /databaseHasColumn\(existing, "assignments", "kind"\)/);
  assert.match(automation, /0034_assignment_learning_modes\.sql/); assert.match(automation, /\["assignments", "kind"\]/);
  assert.match(readiness, /pages\/dictation\/index/);
});
