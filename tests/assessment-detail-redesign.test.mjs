import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 assessment detail protects unsaved score edits and keeps failed input", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  assert.match(detail, /setDirty\(true\)/);
  assert.match(detail, /beforeunload/);
  assert.match(detail, /有未保存修改/);
  assert.match(detail, /if \(saved\) setDirty\(false\)/);
  assert.match(detail, /setSaveError/);
});

test("assessment results receive browser and server validation", async () => {
  const [detail, route] = await Promise.all([
    read("app/v2/operations/[kind]/[id]/OperationDetail.tsx"),
    read("app/api/v2/assessments/[id]/route.ts"),
  ]);

  assert.match(detail, /validateAssessmentResult\(result, totalScore\)/);
  assert.match(route, /validateAssessmentResult/);
  assert.match(route, /成绩列表包含不属于当前班级的学生/);
  assert.match(detail, /空白分数保持待录，不会被当作 0/);
  assert.match(detail, /row\.score == null \|\| row\.score === ""/);
});

test("assessment evidence shows live statistics, weak knowledge and CSV export", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  assert.match(detail, /assessmentStats\(normalized, totalScore\)/);
  for (const label of ["已录入", "平均分", "最高分", "最低分", "平均得分率", "薄弱点证据", "样本不足"]) {
    assert.match(detail, new RegExp(label));
  }
  assert.match(detail, /\/api\/v2\/exports\/assessments\?assessmentId=\$\{id\}/);
});

test("formal assessment completion always enters the approval center", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");
  assert.match(detail, /actionType: "assessment\.complete"/);
  assert.match(detail, /\/api\/v2\/approvals/);
  assert.match(detail, /dirty \|\| !live\.count/);
  assert.match(detail, /正式成绩确认已进入待确认中心/);
});

test("retired assessment detail route and dedicated CSS are removed", async () => {
  await assert.rejects(access(new URL("../app/assessments/[id]/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/assessment-detail.css", import.meta.url)));
  const layout = await read("app/layout.tsx");
  assert.doesNotMatch(layout, /assessment-detail\.css/);
});
