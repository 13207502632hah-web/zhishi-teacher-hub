import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard uses the political-teaching workspace navigation", async () => {
  const [page, shell, layout] = await Promise.all([read("app/page.tsx"), read("app/components/AppShell.tsx"), read("app/layout.tsx")]);
  for (const label of ["工作台","课时记录","学生与班级","题库与组卷","课程反馈","教学反思","数据中心","资源中心","设置"]) assert.match(shell, new RegExp(label));
  assert.match(page, /今日课程/); assert.match(page, /待办事项/); assert.match(page, /重点关注学生/); assert.match(page, /数据不足/);
  assert.doesNotMatch(page, /12,800|4\.9 \/ 5/);
  assert.match(layout, /知师研室｜初高中教师教学工作台/);
});

test("stage one exposes lesson and student persistence surfaces", async () => {
  const [schema, lessonApi, lessonPage, lessonDetail, classPage, studentPage, hosting] = await Promise.all([read("db/schema.ts"),read("app/api/lessons/route.ts"),read("app/lessons/page.tsx"),read("app/lessons/[id]/page.tsx"),read("app/classes/page.tsx"),read("app/students/page.tsx"),read(".openai/hosting.json")]);
  for (const table of ["users","roles","classes","students","enrollments","courses","lessons","attendance","studentLessonRecords","assignments","questions","papers","feedback","reflections","resources","auditLogs"]) assert.match(schema,new RegExp(`export const ${table}`));
  assert.match(hosting,/"d1": "DB"/); assert.match(lessonApi,/export async function POST/); assert.match(lessonPage,/确认删除/); assert.match(lessonPage,/复制/); assert.match(lessonDetail,/window\.print/); assert.match(classPage,/新建班级/); assert.match(studentPage,/监护人联系方式/); assert.match(studentPage,/风险标签必须由教师手动确认/);
});

test("original brand experience remains available as resource center", async () => {
  const resource = await read("app/resources/page.tsx");
  assert.match(resource,/让教学准备/); assert.match(resource,/备课灵感库/); assert.match(resource,/题库导入/);
});
