import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("exam projects use independent resilient requests for projects, results and analytics", async () => {
  const [list, detail] = await Promise.all([read("app/v2/operations/OperationsWorkspace.tsx"), read("app/v2/operations/[kind]/[id]/OperationDetail.tsx")]);
  assert.match(list, /\/api\/v2\/exam-projects/);
  assert.match(detail, /\/api\/v2\/exam-projects\/\$\{id\}\/results/);
  assert.match(detail, /\/api\/v2\/exam-projects\/\$\{id\}\/analytics/);
  assert.match(detail, /analyticsError/);
  assert.match(detail, /统计依据读取失败/);
  assert.doesNotMatch(detail, /Promise\.all/);
});

test("academic-year filtering is explicit and stays local to the loaded project list", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /yearFilter/);
  assert.match(page, /全部学年/);
  assert.match(page, /rows\.filter/);
  assert.doesNotMatch(page, /academicYear=\$\{yearFilter\}/);
});

test("score entry keeps blanks pending, validates before saving, and protects unfinished work", async () => {
  const [page, assessmentLogic] = await Promise.all([
    read("app/v2/operations/[kind]/[id]/OperationDetail.tsx"),
    read("app/lib/assessment.ts"),
  ]);

  assert.match(page, /validateAssessmentResult/);
  assert.match(page, /dirty/);
  assert.match(page, /beforeunload/);
  assert.match(page, /保存失败时保留当前输入/);
  assert.match(page, /nullable/);
  assert.match(page, /待录/);
  assert.match(assessmentLogic, /objectiveScore \+ result\.subjectiveScore - result\.score/);
});

test("template generation explains idempotency and confirms before execution", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /不会重复/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /生成本学年模板/);
});

test("insufficient analytics data is explicit instead of being rendered as zero", async () => {
  const page = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");
  assert.match(page, /数据不足/);
  assert.match(page, /input == null \|\| input === ""/);
  assert.match(page, /summary\.averageRate/);
  assert.match(page, /summary\.volatility/);
});

test("exam projects use the shared responsive V2 workbench with bounded table scrolling", async () => {
  const [page, css] = await Promise.all([
    read("app/v2/operations/[kind]/[id]/OperationDetail.tsx"),
    read("app/v2/v2.css"),
  ]);
  assert.match(page, /v2-score-sheet/);
  assert.match(page, /v2-exam-analytics/);
  assert.match(css, /\.v2-table\{overflow:auto\}/);
  assert.match(css, /@media\(max-width:720px\)/);
});

test("blank scores clear the project member link instead of retaining stale recorded results", async () => {
  const route = await read("app/api/v2/exam-projects/[id]/results/route.ts");

  assert.match(route, /assessment_result_id\s*=\s*NULL/i);
  assert.match(route, /status\s*=\s*'pending'/i);
  assert.match(route, /validateAssessmentResult/);
});

test("template generation remains database-idempotent", async () => {
  const route = await read("app/api/v2/exam-projects/route.ts");

  assert.match(route, /INSERT OR IGNORE INTO exam_projects/);
  assert.match(route, /INSERT OR IGNORE INTO exam_project_students/);
  assert.match(route, /academicYear/);
  assert.match(route, /projectCount/);
});
