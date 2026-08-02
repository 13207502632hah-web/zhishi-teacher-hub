import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("exam projects use independent resilient requests for projects, results and analytics", async () => {
  const page = await read("app/exam-projects/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  for (const state of ["projectLoadState", "resultsLoadState", "analyticsLoadState"]) {
    assert.match(page, new RegExp(state));
  }
  for (const error of ["projectLoadError", "resultsLoadError", "analyticsLoadError"]) {
    assert.match(page, new RegExp(error));
  }
  for (const retry of ["重新读取考试项目", "重新读取成绩", "重新读取统计"]) {
    assert.match(page, new RegExp(retry));
  }
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /Promise\.all/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("academic-year filtering is explicit and does not request on every edit", async () => {
  const page = await read("app/exam-projects/page.tsx");

  assert.match(page, /draftAcademicYear/);
  assert.match(page, /appliedAcademicYear/);
  assert.match(page, /applyAcademicYear/);
  assert.match(page, /应用学年/);
  assert.match(page, /重置学年/);
  assert.match(page, /academicYear=\$\{appliedAcademicYear\}/);
  assert.doesNotMatch(page, /onChange=\{\(event\) => setAcademicYear\(event\.target\.value\)\}/);
});

test("score entry keeps blanks pending, validates before saving, and protects unfinished work", async () => {
  const [page, assessmentLogic] = await Promise.all([
    read("app/exam-projects/page.tsx"),
    read("app/lib/assessment.ts"),
  ]);

  assert.match(page, /validateAssessmentResult/);
  assert.match(page, /resultsBaseline/);
  assert.match(page, /beforeunload/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /保存范围/);
  assert.match(page, /if \(saving\) return/);
  assert.match(page, /finally\s*\{\s*setSaving\(false\)/);
  assert.match(page, /score(?:\.trim\(\))?\s*===\s*""/);
  assert.match(page, /待录/);
  assert.match(page, /保护未保存/);
  assert.match(assessmentLogic, /objectiveScore \+ result\.subjectiveScore - result\.score/);
});

test("template generation explains idempotency and confirms before execution", async () => {
  const page = await read("app/exam-projects/page.tsx");

  assert.match(page, /幂等/);
  assert.match(page, /不会重复/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /生成本学年模板/);
});

test("insufficient analytics data is explicit instead of being rendered as zero", async () => {
  const page = await read("app/exam-projects/page.tsx");

  assert.match(page, /数据不足/);
  assert.match(page, /averageRate\s*==\s*null|averageRate\s*\?\?/);
  assert.match(page, /volatility\s*==\s*null|volatility\s*\?\?/);
  assert.doesNotMatch(page, /averageRate\s*\|\|\s*0/);
  assert.doesNotMatch(page, /volatility\s*\|\|\s*0/);
});

test("exam projects use a CSS Module with readable mobile-first and bounded table scrolling", async () => {
  const [page, css] = await Promise.all([
    read("app/exam-projects/page.tsx"),
    read("app/exam-projects/exam-projects.module.css"),
  ]);

  assert.match(page, /import styles from ["']\.\/exam-projects\.module\.css["']/);
  assert.match(page, /styles\./);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /overflow-x:\s*hidden/);
  for (const breakpoint of ["40rem", "64rem", "80rem"]) {
    assert.match(css, new RegExp(`@media\\s*\\(min-width:\\s*${breakpoint.replace(".", "\\.")}\\)`));
  }
  assert.doesNotMatch(css, /#d8f16b/i);
});

test("blank scores clear the project member link instead of retaining stale recorded results", async () => {
  const route = await read("app/api/exam-projects/[id]/results/route.ts");

  assert.match(route, /assessment_result_id\s*=\s*NULL/i);
  assert.match(route, /status\s*=\s*'pending'/i);
});

test("template generation remains database-idempotent", async () => {
  const route = await read("app/api/exam-projects/route.ts");

  assert.match(route, /INSERT OR IGNORE INTO exam_projects/);
  assert.match(route, /INSERT OR IGNORE INTO exam_project_students/);
  assert.match(route, /academicYear/);
  assert.match(route, /projectCount/);
});
