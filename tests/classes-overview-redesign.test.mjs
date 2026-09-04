import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("class overview uses resilient requests and recoverable list states", async () => {
  const page = await read("app/v2/modules/[slug]/ClassOverviewWorkspace.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /classLoadError/);
  assert.match(page, /重新读取班级/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("class writes cannot overlap and always release busy state", async () => {
  const page = await read("app/v2/modules/[slug]/ClassOverviewWorkspace.tsx");

  assert.match(page, /if \(busy\) return/);
  assert.match(page, /finally\s*\{\s*setBusy\(false\)/);
  assert.match(page, /actionBusy/);
  assert.match(page, /disabled=\{busy/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /JSON\.stringify\(\{ status: nextStatus \}\)/);
  assert.doesNotMatch(page, /setEditing\(row\.id\)[\s\S]{0,200}setForm/);
});

test("class dialog restores focus and protects unsaved changes", async () => {
  const page = await read("app/v2/modules/[slug]/ClassOverviewWorkspace.tsx");

  assert.match(page, /dialogRef/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /beforeunload/);
  assert.match(page, /班级信息尚未保存/);
  assert.match(page, /aria-labelledby="class-dialog-title"/);
  assert.match(page, /tabIndex=\{-1\}/);
});

test("class overview uses shared teaching workspace primitives", async () => {
  const page = await read("app/v2/modules/[slug]/ClassOverviewWorkspace.tsx");

  for (const component of ["Button", "EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /classOverviewMetrics/);
  assert.match(page, /classRosterRail/);
  assert.match(page, /教师确认关注/);
});

test("class overview is V2-native and the legacy page is retired", async () => {
  const [page, workspace] = await Promise.all([
    read("app/v2/modules/[slug]/ClassOverviewWorkspace.tsx"),
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
  ]);

  await assert.rejects(read("app/classes/page.tsx"), { code: "ENOENT" });
  assert.match(workspace, /ClassOverviewWorkspace/);
  assert.match(page, /\/api\/v2\/classes/);
  assert.match(page, /\/v2\/detail\/classes\/\$\{row\.id\}/);
  assert.doesNotMatch(page, /AppShell/);
});

test("class overview styles are readable touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/classes-overview.css"),
  ]);

  assert.match(layout, /import "\.\/classes-overview\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("class create and update share the same name length limit", async () => {
  const [collectionRoute, detailRoute] = await Promise.all([
    read("app/api/v2/classes/route.ts"),
    read("app/api/v2/classes/[id]/route.ts"),
  ]);

  assert.match(collectionRoute, /name\.length > 80/);
  assert.match(detailRoute, /name\.length > 80/);
  assert.match(detailRoute, /班级名称不超过 80 个字符/);
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /set\(\{ status, archivedAt:/);
});
