import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("class detail keeps the primary record recoverable when candidate loading fails", async () => {
  const page = await read("app/classes/[id]/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /detailLoadError/);
  assert.match(page, /candidateLoadError/);
  assert.match(page, /重新读取班级详情/);
  assert.match(page, /重新读取可加入学生/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /Promise\.all/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("class membership mutations cannot overlap and always report failure", async () => {
  const page = await read("app/classes/[id]/page.tsx");

  assert.match(page, /mutationBusy/);
  assert.match(page, /if \(!pick \|\| mutationBusy\) return/);
  assert.match(page, /if \(mutationBusy\) return/);
  assert.match(page, /finally\s*\{\s*setMutationBusy\(null\)/);
  assert.match(page, /加入班级失败/);
  assert.match(page, /移出班级失败/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /disabled=\{Boolean\(mutationBusy\)/);
  assert.match(page, /aria-label=\{`将\$\{student\.name\}移出班级`\}/);
});

test("class detail only exposes membership writes to teachers", async () => {
  const page = await read("app/classes/[id]/page.tsx");

  assert.match(page, /useSessionState/);
  assert.match(page, /const canWrite = session\.role === "teacher"/);
  assert.match(page, /const canScheduleLesson = session\.role === "teacher" \|\| session\.role === "assistant"/);
  assert.match(page, /canWrite \? \(/);
  assert.match(page, /!canWrite \? \(/);
});

test("class detail uses shared workspace primitives and evidence-first sections", async () => {
  const page = await read("app/classes/[id]/page.tsx");

  for (const component of ["Button", "EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /classDetailIdentity/);
  assert.match(page, /aria-label="班级详情快捷导航"/);
  assert.match(page, /id="class-members"/);
  assert.match(page, /id="class-lessons"/);
  assert.match(page, /id="class-assessments"/);
});

test("class detail styles are readable touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/class-detail.css"),
  ]);

  assert.match(layout, /import "\.\/class-detail\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.classDetailMetrics \.zs-metric footer[\s\S]*background:\s*transparent/);
  assert.match(css, /\.classDetailJumpNav\s*\{[\s\S]*height:\s*auto/);
  assert.doesNotMatch(css, /--zs-gold-strong/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("class membership API validates real students and real active relationships", async () => {
  const route = await read("app/api/classes/[id]/route.ts");

  assert.match(route, /requireStudentAccess/);
  assert.match(route, /请选择有效的学生/g);
  assert.match(route, /\.returning\(\)/);
  assert.match(route, /学生不在当前班级/);
  assert.match(route, /if \(!removed\)/);
  assert.match(route, /eq\(students\.status, "active"\)/);
  assert.match(route, /仅可加入进行中的学生/);
});

test("class evidence uses recent lesson order and unique student knowledge counts", async () => {
  const route = await read("app/api/classes/[id]/route.ts");

  assert.match(route, /orderBy\(desc\(lessons\.date\), desc\(lessons\.startTime\)\)/);
  assert.match(route, /studentId/);
  assert.match(route, /Map<string, Set<number>>/);
  assert.match(route, /new Set<number>/);
  assert.match(route, /students\.size/);
  assert.match(route, /COALESCE\(a\.class_id,l\.class_id\)=\?/);
});
