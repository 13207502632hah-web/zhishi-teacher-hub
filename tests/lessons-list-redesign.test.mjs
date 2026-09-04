import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const lessonOverview = "app/v2/modules/[slug]/LessonOverviewWorkspace.tsx";

test("lesson list uses the resilient request client and recoverable loading states", async () => {
  const page = await read(lessonOverview);
  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /lessonLoadError/);
  assert.match(page, /重新读取课时/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("lesson search is explicit and mutations prevent duplicate submission", async () => {
  const page = await read(lessonOverview);
  assert.match(page, /searchInput/);
  assert.match(page, /setQuery\(searchInput\.trim\(\)\)/);
  assert.match(page, /aria-label="搜索课时"/);
  assert.match(page, /submitting/);
  assert.match(page, /if \(submitting\) return/);
  assert.match(page, /disabled=\{submitting\}/);
});

test("lesson list uses shared primitives for states and lesson status", async () => {
  const page = await read(lessonOverview);
  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) assert.match(page, new RegExp(component));
  assert.match(page, /aria-pressed=\{view ===/);
});

test("lesson list styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([read("app/layout.tsx"), read("app/lessons.css")]);
  assert.match(layout, /import "\.\/lessons\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("lesson list shows student names instead of topic placeholders", async () => {
  const page = await read(lessonOverview);
  assert.match(page, /displaySubject/);
  assert.match(page, /item\.displaySubject \|\| item\.courseName/);
  assert.match(page, /item\.topic \? `　课题：\$\{item\.topic\}`/);
  assert.doesNotMatch(page, /未填写课题/);
});

test("lesson overview is V2-native and the legacy page is retired", async () => {
  const [page, workspace, navigation] = await Promise.all([read(lessonOverview), read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/components/navigation.ts")]);
  await assert.rejects(read("app/lessons/page.tsx"), { code: "ENOENT" });
  assert.match(workspace, /LessonOverviewWorkspace/);
  assert.match(page, /\/api\/v2\/lessons/);
  assert.match(page, /\/v2\/detail\/lessons\/\$\{item\.id\}/);
  assert.match(navigation, /\/v2\/modules\/students\?view=lessons/);
  assert.doesNotMatch(page, /AppShell/);
});
