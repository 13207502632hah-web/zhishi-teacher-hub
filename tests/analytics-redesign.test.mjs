import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("analytics is a native V2 learning view and the old page is retired", async () => {
  const [page, workspace, navigation] = await Promise.all([
    read("app/v2/modules/[slug]/page.tsx"),
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/components/navigation.ts"),
  ]);

  assert.match(page, /searchParams/);
  assert.match(page, /initialView=\{query\.view\}/);
  assert.match(workspace, /view === "analytics"/);
  assert.match(workspace, /证据数据中心/);
  assert.match(navigation, /href:\s*"\/v2\/modules\/learning\?view=analytics"/);
  await assert.rejects(access(new URL("../app/analytics/page.tsx", import.meta.url)));
});

test("analytics loading uses the versioned contract, explicit apply, abort and timeout", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  assert.match(workspace, /\/api\/v2\/analytics\?range=\$\{range\}/);
  assert.match(workspace, /AbortController/);
  assert.match(workspace, /loadRequest\.current\?\.abort\(\)/);
  assert.match(workspace, /15_000/);
  assert.match(workspace, /draftRange/);
  assert.match(workspace, /appliedRange/);
  assert.match(workspace, /setAppliedRange\(draftRange\)/);
  assert.match(workspace, /应用筛选/);
  assert.match(workspace, /重置筛选/);
});

test("analytics distinguishes loading, empty, permission and retry states", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const state of ["loading", "ready", "empty", "permission", "error"]) assert.match(workspace, new RegExp(`"${state}"`));
  assert.match(workspace, /status === 401 \|\| status === 403/);
  assert.match(workspace, /role=\{tone \? "alert" : "status"\}/);
  assert.match(workspace, /重新读取/);
  assert.match(workspace, /旧结论已清空/);
});

test("analytics exposes five evidence modules without manufacturing conclusions", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const label of ["教学效率", "学生学习", "题库覆盖", "作业趋势", "教师成长", "统计范围", "数据来源", "数据不足", "分母为 0", "至少两个日期"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /value == null \? "数据不足"/);
  assert.match(workspace, /<ol aria-label=\{`\$\{title\}趋势数据`\}/);
  assert.doesNotMatch(workspace, /style=\{\{\s*height:/);
});

test("native V2 analytics excludes unscored assessments", async () => {
  const route = await read("app/api/v2/analytics/route.ts");

  assert.match(route, /requirePermission\("analytics:read"\)/);
  assert.match(route, /COUNT\(r\.score\) AS total/);
  assert.doesNotMatch(route, /COUNT\(\*\) AS total FROM assessment_results/);
  assert.doesNotMatch(route, /Number\(row\(4\)\.average\s*\|\|\s*0\)/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /^export \{.*from/m);
});

test("V2 analytics is touch-safe, responsive and printable", async () => {
  const css = await read("app/v2/v2.css");

  assert.match(css, /\.v2-learning-tabs a\{[^}]*min-height:38px/);
  assert.match(css, /\.v2-analytics-filter button\{[^}]*min-height:42px/);
  assert.match(css, /@media\(max-width:720px\)[^{]*\{\.v2-learning-tabs/);
  assert.match(css, /\.v2-analytics-filter form button\{[^}]*min-height:44px/);
  assert.match(css, /@media print\{\.v2-learning-tabs/);
  assert.doesNotMatch(css, /\.v2-analytics-list\{[^}]*overflow-x:auto/);
});
