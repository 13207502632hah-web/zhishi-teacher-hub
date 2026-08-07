import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard distinguishes request failures from an empty teaching day", async () => {
  const page = await read("app/page.tsx");

  assert.match(page, /requestJson<DashboardData>/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /dashboardError/);
  assert.match(page, /重新读取/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.ok \? response\.json\(\) : \{ \.\.\.empty/);
});

test("dashboard uses shared foundations and the five-stage teaching loop", async () => {
  const page = await read("app/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  for (const stage of ["备课", "上课", "作业", "反馈", "结算"]) {
    assert.match(page, new RegExp(stage));
  }
  assert.match(page, /dashboardTeachingLoop/);
});

test("dashboard styles keep body copy readable and enhance at a standard desktop breakpoint", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/dashboard.css"),
  ]);

  assert.match(layout, /import "\.\/dashboard\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("dashboard lesson entries prefer student names over topic placeholders", async () => {
  const [page, api] = await Promise.all([
    read("app/page.tsx"),
    read("app/api/dashboard/route.ts"),
  ]);

  assert.match(page, /lesson\.displaySubject \|\| lesson\.topic \|\| lesson\.courseName/);
  assert.match(page, /nextLesson\.displayTitle/);
  assert.match(api, /lesson\.displaySubject \|\| lesson\.topic \|\| lesson\.courseName/);
  assert.match(api, /nextLesson\.displaySubject \|\| nextLesson\.topic \|\| nextLesson\.courseName/);
});
