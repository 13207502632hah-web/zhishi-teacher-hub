import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("student overview keeps student and class requests independently recoverable", async () => {
  const page = await read("app/students/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /studentLoadError/);
  assert.match(page, /classLoadError/);
  assert.match(page, /重新读取学生档案/);
  assert.match(page, /重新读取班级选项/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /Promise\.all/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("student filters apply explicitly instead of requesting on every keystroke", async () => {
  const page = await read("app/students/page.tsx");

  assert.match(page, /draftFilters/);
  assert.match(page, /appliedFilters/);
  assert.match(page, /applyFilters/);
  assert.match(page, /应用筛选/);
  assert.match(page, /重置筛选/);
  assert.doesNotMatch(page, /visible\s*=\s*useMemo/);
});

test("student creation is teacher-only, guarded, and preserves unfinished work", async () => {
  const page = await read("app/students/page.tsx");

  assert.match(page, /useSessionState/);
  assert.match(page, /const canWrite = session\.role === "teacher"/);
  assert.match(page, /if \(!canWrite \|\| saveBusy\) return/);
  assert.match(page, /finally\s*\{\s*setSaveBusy\(false\)/);
  assert.match(page, /dialogRef/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /beforeunload/);
  assert.match(page, /学生档案尚未保存/);
  assert.match(page, /aria-labelledby="student-dialog-title"/);
  assert.match(page, /disabled=\{saveBusy\}/);
});

test("student overview uses shared primitives and evidence-first growth sections", async () => {
  const page = await read("app/students/page.tsx");

  for (const component of ["Button", "EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /studentGrowthRail/);
  assert.match(page, /studentOverviewMetrics/);
  assert.match(page, /成长证据/);
  assert.match(page, /规则依据/);
  assert.match(page, /监护人联系方式不会出现在普通列表/);
});

test("student overview styles are readable touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/students-overview.css"),
  ]);

  assert.match(layout, /import "\.\/students-overview\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*80rem\)/);
  assert.doesNotMatch(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("student creation only enrolls into accessible active classes", async () => {
  const route = await read("app/api/students/route.ts");

  assert.match(route, /requireClassAccess/);
  assert.match(route, /仅可加入进行中的班级/);
  assert.match(route, /status='active'/);
  assert.match(route, /classNames/);
});
