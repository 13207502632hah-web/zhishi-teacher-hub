import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 dashboard reads real teaching evidence and fails closed to zero metrics", async () => {
  const page = await read("app/v2/page.tsx");

  assert.match(page, /env\.DB\.prepare/);
  assert.match(page, /catch \{ return 0; \}/);
  for (const source of ["lessons", "students", "questions", "v2_approvals", "v2_jobs", "assignment_submissions"]) {
    assert.match(page, new RegExp(source));
  }
  assert.doesNotMatch(page, /12,800|4\.9 \/ 5/);
});

test("V2 dashboard exposes the evidence-first teaching workflow and controlled AI boundary", async () => {
  const page = await read("app/v2/page.tsx");

  for (const label of ["今日课时", "在读学生", "可用题目", "待批提交", "后台任务", "待确认中心", "智能课表", "智能题库", "学生与班级", "作业教学闭环", "学情与反馈"]) {
    assert.match(page, new RegExp(label));
  }
  for (const boundary of ["默认匿名化", "多模型路由", "正式动作需确认"]) {
    assert.match(page, new RegExp(boundary));
  }
});

test("V2 dashboard has desktop, tablet and mobile layouts", async () => {
  const [layout, css] = await Promise.all([read("app/layout.tsx"), read("app/v2/v2.css")]);

  assert.match(layout, /import "\.\/v2\/v2\.css"/);
  assert.match(css, /grid-template-columns:244px minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:1050px\)/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /\.v2-shell\{display:block\}/);
  assert.match(css, /\.v2-metric-grid\{grid-template-columns:repeat\(2,1fr\)\}/);
});

test("public root no longer contains the retired workspace dashboard", async () => {
  const page = await read("app/page.tsx");

  assert.doesNotMatch(page, /export function Dashboard|DashboardData|\/api\/dashboard/);
  assert.match(page, /return_to=%2Fv2/);
});
