import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return nested.flat();
}

test("dashboard uses the political-teaching workspace navigation", async () => {
  const [page, shell, layout] = await Promise.all([read("app/page.tsx"), read("app/components/AppShell.tsx"), read("app/layout.tsx")]);
  for (const label of ["工作台","题库检索","组卷草稿","课时记录","学生与班级","测验与成绩","课程反馈","教学反思","数据中心","资源中心","更多工具"]) assert.match(shell, new RegExp(label));
  for (const label of ["今日教学工作台", "导入 Word", "继续校对", "搜索题目", "开始组卷", "今日课程", "今天建议先完成的3件事", "集中待办"]) assert.match(page, new RegExp(label));
  assert.match(page,/\[7,14,30\]/);
  assert.match(page,/horizonDays: days/);
  assert.doesNotMatch(page, /12,800|4\.9 \/ 5/);
  assert.match(layout, /知师研室｜初高中教师教学工作台/);
});

test("route navigation keeps session state mounted and preserves native link behavior", async () => {
  const [layout, shell, provider, hardLink] = await Promise.all([read("app/layout.tsx"), read("app/components/AppShell.tsx"), read("app/components/SessionProvider.tsx"), read("app/components/HardNavigationLink.tsx")]);
  assert.match(layout, /<SessionProvider>\{children\}<\/SessionProvider>/);
  assert.match(provider, /fetch\("\/api\/session"/);
  assert.doesNotMatch(shell, /fetch\("\/api\/session"/);
  assert.doesNotMatch(shell, /onNavigate|preventDefault\(\).*router\.push|useTransition/);
  assert.match(shell, /HardNavigationLink/);
  assert.match(hardLink, /return <a href=\{href\}/);
  assert.doesNotMatch(hardLink, /next\/link/);
  assert.match(shell, /<Link key=\{href\} href=\{href\}/);
  assert.match(shell, /<Link href="\/resources#teaching-method">教学理念<\/Link>/);
});

test("every literal internal hyperlink resolves to an existing page or API route", async () => {
  const files = await sourceFiles(`${projectRoot}/app`);
  const routeFiles = files.filter((path) => /\/(page|route)\.tsx?$/.test(path));
  const routePatterns = routeFiles.map((path) => {
    const relative = path.slice(`${projectRoot}/app`.length).replace(/\/(page|route)\.tsx?$/, "") || "/";
    const pattern = relative.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+");
    return new RegExp(`^${pattern}$`);
  });
  const componentFiles = files.filter((path) => /\.tsx$/.test(path));
  const unresolved = [];
  for (const path of componentFiles) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /from "next\/link"/, `${path.slice(projectRoot.length)} must use full-page navigation`);
    for (const match of source.matchAll(/\bhref="([^"]+)"/g)) {
      const href = match[1];
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const pathname = href.split(/[?#]/, 1)[0] || "/";
      if (!routePatterns.some((pattern) => pattern.test(pathname))) unresolved.push(`${path.slice(projectRoot.length)} -> ${href}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("zero-cost usability optimizations add quick navigation, resilient route states and cheaper question search", async () => {
  const [shell, questions, loading, error, notFound, design] = await Promise.all(["app/components/AppShell.tsx", "app/questions/page.tsx", "app/loading.tsx", "app/error.tsx", "app/not-found.tsx", "app/design-system.css"].map(read));
  assert.match(shell, /Command 或 Control 加 K/); assert.match(shell, /quickSwitcher/); assert.match(shell, /搜索工作台入口/);
  assert.match(questions, /useDebouncedValue/); assert.match(questions, /AbortController/); assert.match(questions, /AbortError/); assert.match(questions, /signal: controller\.signal/);
  assert.match(loading, /正在整理教学工作台/); assert.match(error, /不会因为本次失败自动重复提交/); assert.match(error, /reset/); assert.match(notFound, /没有找到这个页面/);
  assert.match(design, /\.quickSwitcher/); assert.match(design, /\.routeState/); assert.match(design, /prefers-reduced-motion/);
});

test("stage one exposes lesson and student persistence surfaces", async () => {
  const [schema, lessonApi, lessonPage, lessonDetail, classPage, studentPage, hosting] = await Promise.all([read("db/schema.ts"),read("app/api/lessons/route.ts"),read("app/lessons/page.tsx"),read("app/lessons/[id]/page.tsx"),read("app/classes/page.tsx"),read("app/students/page.tsx"),read(".openai/hosting.json")]);
  for (const table of ["users","roles","classes","students","enrollments","courses","lessons","attendance","studentLessonRecords","assignments","questions","papers","feedback","reflections","resources","auditLogs"]) assert.match(schema,new RegExp(`export const ${table}`));
  assert.match(hosting,/"d1": "DB"/); assert.match(lessonApi,/export async function POST/); assert.match(lessonPage,/确认删除/); assert.match(lessonPage,/复制/); assert.match(lessonDetail,/window\.print/); assert.match(classPage,/新建班级/); assert.match(studentPage,/监护人联系方式/); assert.match(studentPage,/风险标签必须由教师手动确认/);
});

test("original brand experience remains available as resource center", async () => {
  const [resource,shell,design] = await Promise.all([read("app/resources/page.tsx"),read("app/components/AppShell.tsx"),read("app/design-system.css")]);
  assert.match(resource,/让教学准备/); assert.match(resource,/备课灵感库/); assert.match(resource,/题库导入/);
  assert.match(resource,/登录后使用/); assert.match(shell,/publicShell/); assert.match(shell,/公开导航/); assert.match(design,/\.publicHeader/); assert.match(design,/\.navGroup/);
});

test("question review URLs, counts and pagination share one contract", async () => {
  const [page,api,dashboard,summary] = await Promise.all([read("app/questions/page.tsx"),read("app/api/questions/route.ts"),read("app/api/dashboard/route.ts"),read("app/lib/question-review.ts")]);
  assert.match(page,/setStatus\(params\.get\("status"\)/); assert.match(page,/setReady\(true\)/); assert.match(page,/选择全部结果/); assert.match(page,/pageCount/); assert.match(page,/reviewIssues\.total/);
  for(const field of ["total","pageCount","allIds","filters","issues"]) assert.match(api,new RegExp(field));
  assert.match(api,/questionReviewSummary/); assert.match(dashboard,/questionReviewSummary/); assert.match(summary,/WHERE status=\?/);
});

test("daily-use design keeps lesson and assessment states explicit", async () => {
  const [lesson,assessment,design] = await Promise.all([read("app/lessons/[id]/page.tsx"),read("app/assessments/[id]/page.tsx"),read("app/design-system.css")]);
  for(const label of ["签到","教学内容","课堂表现","作业","反馈","下节计划","整理为反馈草稿"]) assert.match(lesson,new RegExp(label));
  assert.match(assessment,/样本不足/); assert.match(assessment,/有未保存修改/); assert.match(design,/position:sticky/); assert.match(design,/min-height:44px/);
});

test("next-stage workflows cover WeChat feedback, whole papers, review and explainable attention", async () => {
  const [schema, feedbackPage, generator, copied, paperPage, paperDetail, upload, files, questions, batch, readiness, reviewService, studentRoute, studentPage, migration] = await Promise.all([
    "db/schema.ts","app/feedback/page.tsx","app/lib/feedback-generator.ts","app/api/feedback/[id]/copied/route.ts","app/papers/page.tsx","app/papers/[id]/page.tsx","app/api/papers/upload/route.ts","app/api/papers/[id]/files/route.ts","app/api/questions/route.ts","app/api/questions/batch/route.ts","app/lib/question-readiness.ts","app/lib/services/question-review-service.ts","app/api/students/[id]/route.ts","app/students/[id]/page.tsx","drizzle/0014_teacher_feedback_papers.sql",
  ].map(read));
  for (const entity of ["feedbackTemplates","paperFiles","copiedAt","shortContent","standardContent","useStatus"]) assert.match(schema,new RegExp(entity));
  for (const label of ["微信私聊版","家长群版","复制简短版","复制标准版","预计提交时间","简短补充"]) assert.match(feedbackPage,new RegExp(label));
  assert.match(generator,/generateFeedback/); assert.match(generator,/previousHomework/); assert.match(copied,/copied_at/);
  for (const label of ["上传整张试卷","上传并保存原卷","原卷优先"]) assert.match(paperPage,new RegExp(label));
  for (const label of ["整张试卷版本","打开并打印原卷","布置为作业"]) assert.match(paperDetail,new RegExp(label));
  assert.match(upload,/env\.FILES\.put/); assert.match(upload,/30 \* 1024 \* 1024/); assert.match(files,/assignment_submissions/);
  assert.match(questions,/issue === "ready"/); assert.match(batch,/reviewQuestions/); assert.match(reviewService,/questionReadinessIssues/); assert.match(readiness,/疑似重复/); assert.match(readiness,/主观题缺少采分点或解析/);
  assert.match(studentRoute,/attention/); assert.match(studentRoute,/得分率下降/); assert.match(studentPage,/学习关注事项/); assert.match(studentPage,/生成阶段总结/);
  for (const field of ["paper_files","feedback_templates","copied_at","paper_id"]) assert.match(migration,new RegExp(field));
});

test("reviewed questions can enter the formal bank without one blocked item stopping the group", async () => {
  const [confirmRoute, batchRoute, reviewService, page, readiness] = await Promise.all([read("app/api/question-sets/[id]/confirm/route.ts"),read("app/api/questions/batch/route.ts"),read("app/lib/services/question-review-service.ts"),read("app/questions/page.tsx"),read("app/lib/question-readiness.ts")]);
  assert.match(confirmRoute,/reviewedIds/); assert.match(confirmRoute,/partial/); assert.match(confirmRoute,/promoted/); assert.match(confirmRoute,/reviewQuestions/);
  assert.match(batchRoute,/reviewQuestions/); assert.match(reviewService,/questionReadinessIssues/); assert.match(reviewService,/status='active'/); assert.match(page,/将已校对且合格的题目入库/); assert.doesNotMatch(page,/disabled=\{reviewCount !== parsed\.length\}/);
  assert.match(readiness,/主观题缺少采分点或解析/); assert.match(readiness,/缺少选项/); assert.match(readiness,/识别置信度低/);
});

test("Word imports accept the advertised size and explain non-JSON upload failures", async () => {
  const [config, page, source] = await Promise.all([read("next.config.ts"), read("app/questions/page.tsx"), read("app/api/question-sets/source/route.ts")]);
  assert.match(config, /bodySizeLimit:\s*"20mb"/); assert.match(page, /response\.text\(\)/); assert.match(page, /超过服务器接收上限/);
  assert.match(page, /15 \* 1024 \* 1024/); assert.match(source, /15 \* 1024 \* 1024/); assert.match(source, /status: 413/);
});

test("question-bank-first workflow exposes queue, saved views, indexed search and durable paper cart", async () => {
  const [page, questionApi, viewsApi, facetsApi, migration, schema, papers, shell, dashboard] = await Promise.all([read("app/questions/page.tsx"), read("app/api/questions/route.ts"), read("app/api/question-views/route.ts"), read("app/api/questions/facets/route.ts"), read("drizzle/0021_question_bank_search.sql"), read("db/schema.ts"), read("app/papers/page.tsx"), read("app/components/AppShell.tsx"), read("app/page.tsx")]);
  for (const label of ["批量导入 Word", "Word 导入队列", "保存筛选", "最近：", "加入试卷草稿", "相似题并排核对", "使用次数从多到少"]) assert.match(page, new RegExp(label));
  assert.match(page, /multiple type="file"/); assert.match(page, /question-import-queue/); assert.match(page, /单个文件失败不会中断后续文件/);
  assert.match(questionApi, /use_count_desc/); assert.match(questionApi, /params\.get\("ids"\)/); assert.match(facetsApi, /textbook_version/);
  assert.match(viewsApi, /ownerId/); assert.match(viewsApi, /allowedKeys/); assert.match(schema, /savedQuestionViews/);
  for (const index of ["question_search_textbook_index", "question_search_knowledge_index", "question_search_sort_index"]) assert.match(migration, new RegExp(index));
  assert.match(papers, /paper-workbench/); assert.match(papers, /paper-cart/); assert.match(shell, /题库检索/); assert.match(shell, /微信小程序（暂停）/); assert.match(dashboard, /今日教学工作台/); assert.match(dashboard, /题库与组卷/);
});

test("lesson closure persists attendance, performance, homework, feedback and review finance", async () => {
  const [activity, detail, dashboard, classDetail, students] = await Promise.all([read("app/api/lessons/[id]/activity/route.ts"),read("app/lessons/[id]/page.tsx"),read("app/api/dashboard/route.ts"),read("app/classes/[id]/page.tsx"),read("app/students/page.tsx")]);
  assert.match(activity,/studentRecord/); assert.match(activity,/saveDraft/); assert.match(activity,/validateLessonCompletion/); assert.match(activity,/ON CONFLICT\(lesson_id,student_id\)/); assert.match(activity,/assignment_submissions/); assert.match(activity,/INSERT INTO feedback/); assert.match(activity,/lesson_finance/); assert.match(activity,/status!='review'|status !== "review"/);
  for (const label of ["学生出勤与课堂表现","单独保存作业草稿","单独保存反馈","教师确认关注","保存草稿","一键完成本节课","待核对"]) assert.match(detail,new RegExp(label));
  assert.match(dashboard,/SELECT COUNT\(\*\) AS total/); assert.match(dashboard,/pendingFinance/); assert.match(classDetail,/平均出勤/); assert.match(students,/全部班级/);
});

test("daily cockpit milestones stay connected to durable, evidence-backed APIs", async () => {
  const [dashboard, prep, workflow, activity, questionStats, similar, insights, attention, feedbackApi, financeApi, monthly, financeExport, migration22, migration23] = await Promise.all([
    "app/api/dashboard/route.ts", "app/api/lessons/[id]/prep/route.ts", "app/api/lessons/[id]/workflow-state/route.ts", "app/api/lessons/[id]/activity/route.ts", "app/api/questions/stats/route.ts", "app/api/questions/[id]/similar/route.ts", "app/api/students/[id]/insights/route.ts", "app/api/students/attention/route.ts", "app/api/feedback/route.ts", "app/api/finance/route.ts", "app/lib/finance-monthly.ts", "app/api/finance/export/route.ts", "drizzle/0022_daily_workflow.sql", "drizzle/0023_learning_evidence_finance.sql",
  ].map(read));
  assert.match(dashboard, /\[7, 14, 30\]/); assert.match(dashboard, /suggestedActions/); assert.match(dashboard, /weekStart: monday/); assert.match(dashboard, /nextLesson/);
  for (const label of ["教材版本一致", "册别一致", "单元一致", "课题匹配", "知识点匹配"]) assert.match(prep, new RegExp(label));
  assert.match(workflow, /revision/); assert.match(workflow, /status: 409/); assert.match(activity, /undoLatestCompletion/); assert.match(activity, /存在受保护产物/); assert.match(activity, /complete_idempotent/);
  assert.match(questionStats, /missingAnswer/); assert.match(questionStats, /useCount/); assert.match(similar, /questionTextSimilarity/); assert.match(similar, /不会自动删除/);
  for (const evidence of ["attendance", "assignments", "assessments", "wrongQuestions", "observations", "数据不足"]) assert.match(insights, new RegExp(evidence));
  assert.match(attention, /previous - current >= 8/); assert.match(attention, /early.*recent/); assert.match(feedbackApi, /feedback_evidence/);
  assert.match(financeApi, /pricing_rule_id/); assert.match(financeApi, /calculation_snapshot/); assert.match(monthly, /出勤登记不完整/); assert.match(financeExport, /月度核对清单/); assert.match(financeExport, /课时结算明细/);
  for (const table of ["lesson_workflow_state", "lesson_completion_runs", "workflow_templates"]) assert.match(migration22, new RegExp(table));
  for (const field of ["feedback_evidence", "pricing_rule_id", "calculation_snapshot"]) assert.match(migration23, new RegExp(field));
});

test("comprehensive repairs connect lazy answers, imports, exams, promotion and mini review", async () => {
  const [questions, contentApi, reviewApi, paperImport, lessonDisplay, feedbackImport, feedbackPage, recognition, examPage, trends, promotion, dashboard, migration24, migration25, miniHome, miniReview] = await Promise.all([
    "app/questions/page.tsx", "app/api/questions/[id]/content/route.ts", "app/api/questions/[id]/review/route.ts", "app/api/question-sets/import/route.ts", "app/lib/lesson-display.ts", "app/lib/feedback-import.ts", "app/feedback-imports/page.tsx", "app/recognition/page.tsx", "app/exam-projects/page.tsx", "app/api/students/[id]/score-trends/route.ts", "app/lib/services/grade-promotion-service.ts", "app/api/dashboard/route.ts", "drizzle/0024_paper_feedback_workflow.sql", "drizzle/0025_academic_exam_analytics.sql", "mini-program/pages/home/index.wxml", "mini-program/pages/review/index.wxml",
  ].map(read));
  for (const state of ["加载中", "读取失败", "待补充", "重试题目"]) assert.match(questions, new RegExp(state));
  assert.match(contentApi, /standardExpression/); assert.match(reviewApi, /expectedUpdatedAt/); assert.match(paperImport, /paperId/);
  assert.match(lessonDisplay, /studentNames/); assert.match(lessonDisplay, /startTime/); assert.match(feedbackImport, /confidence/); assert.match(feedbackPage, /原文证据/); assert.match(feedbackPage, /未发布草稿/);
  assert.match(recognition, /【存疑】/); assert.match(recognition, /本机浏览器/); assert.match(examPage, /待录/); assert.match(examPage, /成绩波动度/); assert.match(trends, /movingAverage/); assert.match(trends, /数据不足/);
  assert.match(promotion, /INSERT OR IGNORE/); assert.match(dashboard, /today\.slice\(5, 7\) === "09"/); assert.match(dashboard, /核对新学年年级晋升/);
  for (const field of ["feedback_imports", "academic_year", "exam_category", "district"]) assert.match(migration24, new RegExp(field));
  for (const table of ["academic_years", "exam_projects", "exam_project_students", "grade_promotion_runs", "review_assets"]) assert.match(migration25, new RegExp(table));
  for (const label of ["布置作业", "作业收件箱", "连续批改"]) assert.match(miniHome, new RegExp(label));
  assert.match(miniReview, /圈画/); assert.match(miniReview, /语音评语/); assert.match(miniReview, /确认并回传/);
});

test("stage two covers political question review, paper drafting and lesson links", async () => {
  const [schema, page, parser, importApi, confirmApi, reviewService, paperPage, paperApi, lessonQuestions] = await Promise.all([read("db/schema.ts"),read("app/questions/page.tsx"),read("app/lib/question-import.ts"),read("app/api/question-sets/import/route.ts"),read("app/api/question-sets/[id]/confirm/route.ts"),read("app/lib/services/question-review-service.ts"),read("app/papers/page.tsx"),read("app/api/papers/route.ts"),read("app/api/lessons/[id]/questions/route.ts")]);
  for (const field of ["factBasis","textbookView","valueJudgment","answerLogic","standardExpression","coreCompetencies","isFavorite","isWrong","isFrequent"]) assert.match(schema,new RegExp(field));
  for (const label of ["正式题库","待校对","Word 导入","事实依据","教材观点","价值判断","答题逻辑","规范表述","识别报告","政治题目核对四点","必修3 政治与法治"]) assert.match(page,new RegExp(label));
  for (const marker of ["parsePoliticsDocx","summarizeImport","缺少答案","缺少知识点","缺少解析","题库的难度系数越高代表越容易"]) assert.match(parser,new RegExp(marker));
  assert.match(importApi,/status:\s*"review"/); assert.match(confirmApi,/reviewQuestions/); assert.match(reviewService,/status='active'/); assert.match(page,/将已校对且合格的题目入库/);
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
