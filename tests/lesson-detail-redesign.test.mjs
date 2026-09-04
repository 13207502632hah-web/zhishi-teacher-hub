import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const lessonDetail = "app/v2/detail/[kind]/[id]/LessonDetailWorkspace.tsx";

test("lesson detail loads every teaching-loop surface through the resilient client", async () => {
  const page = await read(lessonDetail);
  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /detailLoadError/);
  assert.match(page, /重新读取课时详情/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("lesson detail protects unsaved work and duplicate mutations", async () => {
  const page = await read(lessonDetail);
  assert.match(page, /beforeunload/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /event\.returnValue = ""/);
  assert.match(page, /if \(busy\) return/);
  assert.match(page, /disabled=\{busy/);
  assert.match(page, /finally/);
});

test("lesson detail exposes the shared teaching loop and status language", async () => {
  const page = await read(lessonDetail);
  assert.match(page, /TeachingLoopTrack/);
  assert.match(page, /activeStage=\{/);
  assert.match(page, /StatusBadge/);
  assert.match(page, /aria-label="课时详情快捷导航"/);
});

test("lesson detail styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([read("app/layout.tsx"), read("app/lesson-detail.css")]);
  assert.match(layout, /import "\.\/lesson-detail\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("lesson detail is V2-native and every teaching-loop request is versioned", async () => {
  const [page, router] = await Promise.all([read(lessonDetail), read("app/v2/detail/[kind]/[id]/page.tsx")]);
  await assert.rejects(read("app/lessons/[id]/page.tsx"), { code: "ENOENT" });
  assert.match(router, /LessonDetailWorkspace/);
  for (const endpoint of ["activity", "prep", "workflow-state"]) assert.match(page, new RegExp(`/api/v2/lessons/\\$\\{id\\}/${endpoint}`));
  assert.match(page, /\/api\/v2\/ai\/lesson-prep/);
  assert.match(page, /\/api\/v2\/ai\/schedule-reschedule/);
  assert.doesNotMatch(page, /AppShell|useParams/);
});
