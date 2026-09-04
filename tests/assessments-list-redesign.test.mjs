import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 assessment list loads its evidence and recovers from request failures", async () => {
  const workspace = await read("app/v2/operations/OperationsWorkspace.tsx");

  for (const endpoint of ["/api/v2/assessments", "/api/v2/classes?status=active&pageSize=200", "/api/v2/papers?status=all"]) {
    assert.match(workspace, new RegExp(endpoint.replace(/[?]/g, "\\?")));
  }
  assert.match(workspace, /if \(!response\.ok\) throw new Error/);
  assert.match(workspace, /教学运营数据暂时无法读取/);
  assert.match(workspace, /↻ 刷新数据/);
});

test("assessment creation is single-flight and keeps optional paper and notes", async () => {
  const workspace = await read("app/v2/operations/OperationsWorkspace.tsx");

  assert.match(workspace, /setBusy\(true\)/);
  assert.match(workspace, /finally \{ setBusy\(false\); \}/);
  assert.match(workspace, /paperId: fields\.paperId \? Number\(fields\.paperId\) : null/);
  assert.match(workspace, /name="paperId"/);
  assert.match(workspace, /name="notes"/);
  assert.match(workspace, /disabled=\{busy\}/);
  assert.match(workspace, /保存中…/);
});

test("assessment list supports class and status filters, direct class context and CSV export", async () => {
  const [workspace, page] = await Promise.all([
    read("app/v2/operations/OperationsWorkspace.tsx"),
    read("app/v2/operations/page.tsx"),
  ]);

  assert.match(workspace, /classFilter/);
  assert.match(workspace, /statusFilter/);
  assert.match(workspace, /useMemo/);
  assert.match(workspace, /\/api\/v2\/exports\/assessments/);
  assert.match(workspace, /initialAssessmentClassId/);
  assert.match(page, /classId/);
  assert.match(page, /initialAssessmentClassId/);
  assert.match(workspace, /\/v2\/operations\/assessments\/\$\{row\.id\}/);
});

test("retired assessment list route and dedicated CSS are removed", async () => {
  await assert.rejects(access(new URL("../app/assessments/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/assessments-list.css", import.meta.url)));
  const [layout, navigation] = await Promise.all([read("app/layout.tsx"), read("app/components/navigation.ts")]);
  assert.doesNotMatch(layout, /assessments-list\.css/);
  assert.match(navigation, /href:\s*"\/v2\/operations\?tab=assessments"/);
  assert.doesNotMatch(navigation, /href:\s*"\/assessments"/);
});

test("V2 assessment filters and controls remain touch-safe on phones", async () => {
  const css = await read("app/v2/v2.css");
  assert.match(css, /\.v2-ops-filters/);
  assert.match(css, /\.v2-score-sheet \.v2-table input\{min-height:44px\}/);
  assert.match(css, /@media\(max-width:720px\)/);
});
