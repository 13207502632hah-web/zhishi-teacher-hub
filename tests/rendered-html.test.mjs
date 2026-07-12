import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard uses the political-teaching workspace navigation", async () => {
  const [page, shell, layout] = await Promise.all([read("app/page.tsx"), read("app/components/AppShell.tsx"), read("app/layout.tsx")]);
  for (const label of ["工作台","课时记录","学生与班级","测验与成绩","题库与组卷","课程反馈","教学反思","数据中心","资源中心","设置"]) assert.match(shell, new RegExp(label));
  assert.match(page, /今日课程/); assert.match(page, /待办事项/); assert.match(page, /重点关注学生/); assert.match(page, /数据不足/); assert.match(page,/三步建立政治教学工作台/); assert.match(page,/导入第一份试卷/);
  assert.match(page,/r\.ok\?r\.json\(\):empty/);
  assert.doesNotMatch(page, /12,800|4\.9 \/ 5/);
  assert.match(layout, /知师研室｜初高中教师教学工作台/);
});

test("route transitions keep session state mounted and expose a subtle pending state", async () => {
  const [layout, shell, provider, css] = await Promise.all([read("app/layout.tsx"), read("app/components/AppShell.tsx"), read("app/components/SessionProvider.tsx"), read("app/responsive-fixes.css")]);
  assert.match(layout, /<SessionProvider>\{children\}<\/SessionProvider>/);
  assert.match(provider, /fetch\("\/api\/session"/);
  assert.doesNotMatch(shell, /fetch\("\/api\/session"/);
  assert.match(shell, /useTransition/);
  assert.match(shell, /onNavigate/);
  assert.match(shell, /aria-busy=\{isPending\}/);
  assert.match(css, /nav\[aria-busy="true"\]/);
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

test("lesson closure persists attendance, performance, homework and feedback", async () => {
  const [activity, detail, dashboard, classDetail, students] = await Promise.all([read("app/api/lessons/[id]/activity/route.ts"),read("app/lessons/[id]/page.tsx"),read("app/api/dashboard/route.ts"),read("app/classes/[id]/page.tsx"),read("app/students/page.tsx")]);
  assert.match(activity,/studentRecord/); assert.match(activity,/ON CONFLICT\(lesson_id,student_id\)/); assert.match(activity,/assignment_submissions/); assert.match(activity,/INSERT INTO feedback/);
  for (const label of ["出勤与课堂记录","布置作业","保存反馈草稿","教师确认关注"]) assert.match(detail,new RegExp(label));
  assert.match(dashboard,/SELECT COUNT\(\*\) AS total/); assert.match(classDetail,/平均出勤/); assert.match(students,/全部班级/);
});

test("stage two covers political question review, paper drafting and lesson links", async () => {
  const [schema, page, parser, importApi, confirmApi, paperPage, paperApi, lessonQuestions] = await Promise.all([read("db/schema.ts"),read("app/questions/page.tsx"),read("app/lib/question-import.ts"),read("app/api/question-sets/import/route.ts"),read("app/api/question-sets/[id]/confirm/route.ts"),read("app/papers/page.tsx"),read("app/api/papers/route.ts"),read("app/api/lessons/[id]/questions/route.ts")]);
  for (const field of ["factBasis","textbookView","valueJudgment","answerLogic","standardExpression","coreCompetencies","isFavorite","isWrong","isFrequent"]) assert.match(schema,new RegExp(field));
  for (const label of ["正式题库","待校对","Word 导入","事实依据","教材观点","价值判断","答题逻辑","规范表述","识别报告","政治题目核对四点","必修3 政治与法治"]) assert.match(page,new RegExp(label));
  for (const marker of ["parsePoliticsDocx","summarizeImport","缺少答案","缺少知识点","缺少解析","题库的难度系数越高代表越容易"]) assert.match(parser,new RegExp(marker));
  assert.match(importApi,/status:\s*"review"/); assert.match(confirmApi,/status:\s*"active"/); assert.match(page,/逐题标记为已校对/);
  for (const label of ["自动推荐题目","手动添加","保存试卷草稿","练习","周测","阶段测","讲义题组"]) assert.match(paperPage,new RegExp(label));
  assert.match(paperApi,/paperQuestions/); assert.match(lessonQuestions,/lessonQuestions/);
});

test("stage three uses real records for feedback, reflection and analytics", async () => {
  const [schema, feedbackPage, feedbackSummary, reflectionPage, reflectionApi, analyticsPage, analyticsApi, resourcePage] = await Promise.all([read("db/schema.ts"),read("app/feedback/page.tsx"),read("app/api/feedback/summary/route.ts"),read("app/reflections/page.tsx"),read("app/api/reflections/route.ts"),read("app/analytics/page.tsx"),read("app/api/analytics/route.ts"),read("app/resources/page.tsx")]);
  for (const field of ["learningContent","periodStart","periodSummary","problemType","actionCompleted","sourceRef"]) assert.match(schema,new RegExp(field));
  for (const label of ["单节课反馈","阶段反馈","专业简洁","温和鼓励","重点提醒","汇总真实课时、出勤、作业与测验","尚未发送"]) assert.match(feedbackPage,new RegExp(label));
  for (const table of ["lessons","attendance","assignment_submissions","assessment_results","student_lesson_records"]) assert.match(feedbackSummary,new RegExp(table));
  for (const label of ["全文搜索","全部班级","全部问题类型","日历","沉淀为策略","完整内容默认私密"]) assert.match(reflectionPage,new RegExp(label));
  assert.match(reflectionApi,/lessonTopic/); assert.match(reflectionApi,/className/);
  for (const label of ["周","月","学期","口径说明","数据不足","反馈及时率","知识点覆盖率","常用题目"]) assert.match(analyticsPage,new RegExp(label));
  assert.match(analyticsApi,/julianday/); assert.match(analyticsApi,/f\.status='confirmed'/); assert.match(analyticsApi,/use_count/); assert.match(resourcePage,/这里不会填充虚构资源/);
});

test("stage four enforces roles, logs sensitive actions and requires destructive confirmations", async () => {
  const [access, shell, settings, settingsApi, exportApi, deleteApi, portalApi, privateStudent, css, schema, teacherAuth, teacherLogin] = await Promise.all([read("app/lib/access.ts"),read("app/components/AppShell.tsx"),read("app/settings/page.tsx"),read("app/api/settings/route.ts"),read("app/api/settings/export/route.ts"),read("app/api/settings/data/route.ts"),read("app/api/portal/route.ts"),read("app/api/students/[id]/private/route.ts"),read("app/globals.css"),read("db/schema.ts"),read("app/lib/teacher-auth.ts"),read("app/teacher-login/page.tsx")]);
  for (const role of ["teacher","assistant","student","parent"]) assert.match(access,new RegExp(role));
  assert.match(access,/requirePermission/); assert.match(shell,/teacher-login/); assert.match(shell,/资源中心仍可公开浏览/); assert.match(shell,/aria-current/); assert.match(shell,/跳到主要内容/); assert.match(teacherAuth,/HttpOnly/); assert.match(teacherAuth,/SameSite=Lax/); assert.match(teacherAuth,/crypto\.subtle/); assert.match(teacherLogin,/教师管理员登录/);
  for (const label of ["账号与角色","助教","学生","家长","操作日志","二次确认后导出","删除全部教学数据"]) assert.match(settings,new RegExp(label));
  assert.match(settingsApi,/assign_role/); assert.match(exportApi,/Content-Disposition/); assert.match(exportApi,/audit\(access,\s*"export"/); assert.match(deleteApi,/confirmation !== "删除全部教学数据"/); assert.match(deleteApi,/delete_all/);
  assert.match(portalApi,/status='confirmed'/); assert.match(portalApi,/guardian_user_id/); assert.match(privateStudent,/view_sensitive/);
  assert.match(css,/prefers-reduced-motion/); assert.match(css,/:focus-visible/); assert.match(schema,/visibility/); assert.match(schema,/guardianUserId/);
});
