import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");

const loadTsModule = async (path) => {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText: code } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const evaluatedModule = { exports: {} };
  new Function("module", "exports", code)(evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
};

test("Word parser keeps question, answer, analysis and knowledge for political papers", async () => {
  const { parsePoliticsDocx, summarizeImport } = await loadTsModule("app/lib/question-import.ts");
  const parsed = parsePoliticsDocx(`一、单项选择题\n1．全过程人民民主是最广泛、最真实、最管用的民主。\nA．人民当家作主\nB．资本决定政治\n【答案】A\n【详解】人民民主的本质是人民当家作主。\n【知识点】全过程人民民主\n【难度】0.82\n2．我国宪法是治国安邦的总章程。\n【答案】正确\n【解析】宪法具有最高法律效力。\n【知识点】宪法\n【难度】0.65`, { stage: "高中", grade: "高一" });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].questionType, "单选题");
  assert.match(parsed[0].options, /A．人民当家作主/);
  assert.equal(parsed[0].answer, "A");
  assert.equal(parsed[0].difficulty, 2);
  assert.equal(parsed[1].difficulty, 4);
  const summary = summarizeImport(parsed);
  assert.deepEqual({ total: summary.total, answered: summary.answered, tagged: summary.tagged, explained: summary.explained }, { total: 2, answered: 2, tagged: 2, explained: 2 });
  assert.doesNotThrow(() => summarizeImport([{ questionType: "单选题", answer: "A", knowledgePoints: "法治", analysis: "解析" }]));
});

test("Word parser separates political materials and keeps scoring evidence", async () => {
  const { parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const parsed = parsePoliticsDocx(`仅供测试使用\n二、材料分析题\n8．【材料】某市全过程人民民主实践不断丰富。\n【设问】结合材料，说明全过程人民民主的特点。\n【答案】全过程人民民主是最广泛、最真实、最管用的民主。\n【采分点】党的领导；人民当家作主；依法治国。\n【解析】答案应将教材观点与材料信息对应。\n【教材依据】人民民主是社会主义的生命。\n【答题逻辑】观点—材料—结论。\n【规范表述】全过程人民民主是社会主义民主政治的本质属性。\n【知识点】全过程人民民主\n【分值】9\n【难度】4\n第 2 页 共 3 页`, { stage: "高中", grade: "高二" });
  assert.equal(parsed.length, 1);
  assert.match(parsed[0].material, /某市全过程人民民主实践/);
  assert.doesNotMatch(parsed[0].stem, /【材料】/);
  assert.equal(parsed[0].score, 9);
  assert.equal(parsed[0].difficulty, 4);
  assert.match(parsed[0].answerPoints, /党的领导/);
  assert.match(parsed[0].standardExpression, /本质属性/);
});

test("Word parser merges a separated reference-answer section without duplicating questions", async () => {
  const { parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const parsed = parsePoliticsDocx(`八下选择题专练
一、单选题
1．人民法院应当依法独立公正行使审判权。（ ）
A．正确选项
B．干扰选项
2．人民政协围绕民生问题开展调研。（ ）
A．正确选项
B．干扰选项
《八下选择题专练》参考答案
题号
1
2
答案
A
B
1．A
【知识点】人民法院的性质与职权
【详解】人民法院是国家审判机关。
2．B
【知识点】人民政协的职能
【详解】人民政协履行政治协商、民主监督和参政议政职能。`, { stage: "初中", grade: "八年级" });
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((question) => question.answer), ["A", "B"]);
  assert.deepEqual(parsed.map((question) => question.sourceQuestionNumber), [1, 2]);
  assert.ok(parsed.every((question) => question.analysis && question.knowledgePoints));
});

test("Word parser expands grouped answers and shared explanations", async () => {
  const { parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const questions = [27, 28, 29, 30].map((number) => `${number}．第${number}题（ ）\nA．选项一\nB．选项二\nC．选项三\nD．选项四`).join("\n");
  const parsed = parsePoliticsDocx(`一、单选题\n${questions}\n参考答案\n27．B    28．C    29．A    30．D\n【知识点】中华优秀传统文化\n【详解】27．第一题解析。\n28．第二题解析。\n29．第三题解析。\n30．第四题解析。`, { stage: "初中", grade: "八年级" });
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed.map((question) => question.answer), ["B", "C", "A", "D"]);
  assert.ok(parsed.every((question) => question.analysis && question.knowledgePoints));
});

test("Word media stays with the nearest numbered political question", async () => {
  const { enrichQuestionsFromHtml, parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const questions = parsePoliticsDocx(`一、选择题\n1．第一题\n【答案】A\n【解析】解析一\n【知识点】知识点一\n2．第二题\n【答案】B\n【解析】解析二\n【知识点】知识点二`, {});
  const enriched = enrichQuestionsFromHtml(`<p>1．第一题<img src="data:image/png;base64,one" alt="第一题图"></p><p>2．第二题</p><table><tr><td>第二题表格</td></tr></table>`, questions);
  assert.equal(enriched[0].attachments.length, 1);
  assert.equal(enriched[0].tables.length, 0);
  assert.equal(enriched[1].attachments.length, 0);
  assert.deepEqual(enriched[1].tables[0].rows, [["第二题表格"]]);
  assert.doesNotMatch(enriched[0].importNotes.join(" "), /位于首道/);
});

test("uncertain Word media is marked instead of silently guessed", async () => {
  const { enrichQuestionsFromHtml, parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const questions = parsePoliticsDocx(`一、选择题\n1．题干\n【答案】A\n【解析】解析\n【知识点】法治`, {});
  const [question] = enrichQuestionsFromHtml(`<p><img src="before.png"></p><p>1．题干</p>`, questions);
  assert.match(question.importNotes.join(" "), /【存疑】/);
  assert.equal(question.attachments[0].uncertainPosition, true);
});

test("similarity warns for near duplicate political questions without equating unrelated stems", async () => {
  const { questionTextSimilarity } = await loadTsModule("app/lib/question-similarity.ts");
  assert.ok(questionTextSimilarity("全过程人民民主是最广泛、最真实、最管用的民主", "全过程人民民主，是最广泛最真实最管用的民主。") >= .82);
  assert.ok(questionTextSimilarity("我国坚持依法治国", "商品价格由价值决定并受供求影响") < .5);
});

test("three real docx fixtures survive Mammoth extraction and political parsing", async () => {
  const mammoth = require("mammoth");
  const { parsePoliticsDocx } = await loadTsModule("app/lib/question-import.ts");
  const fixtures = [
    ["01-初中道德与法治试卷.docx", 3, "初中", "九年级"],
    ["02-高中选择题专题卷.docx", 6, "高中", "高一"],
    ["03-材料分析综合卷.docx", 3, "高中", "高二"],
  ];
  for (const [name, expected, stage, grade] of fixtures) {
    const path = fileURLToPath(new URL(`../tests/fixtures/word-import/${name}`, import.meta.url));
    const extracted = await mammoth.extractRawText({ path });
    const parsed = parsePoliticsDocx(extracted.value, { stage, grade, sourceFile: name });
    assert.equal(parsed.length, expected, `${name} should parse ${expected} questions`);
    assert.equal(new Set(parsed.map((question) => question.stem)).size, expected, `${name} should contain distinct questions`);
    assert.ok(parsed.every((question) => question.answer && question.analysis && question.knowledgePoints));
    assert.ok(parsed.filter((question) => question.questionType.includes("选题")).every((question) => /\nB[．.、]/.test(question.options)), `${name} should preserve option line breaks`);
  }
});

test("question fingerprints ignore whitespace-only differences", async () => {
  const { questionFingerprint } = await loadTsModule("app/lib/question-fingerprint.ts");
  const first = questionFingerprint({ stem: "我国  坚持  人民民主", options: "A．人民当家作主" }), second = questionFingerprint({ stem: "我国 坚持 人民民主", options: "A．人民当家作主" });
  assert.equal(first, second);
});

test("question readiness allows valid reviewed items to enter the formal bank independently", async () => {
  const { questionReadinessIssues } = await loadTsModule("app/lib/question-readiness.ts");
  assert.deepEqual(questionReadinessIssues({ reviewed: true, questionType: "单选题", stem: "题干", options: "A．选项", answer: "A", knowledgePoints: "法治", parseConfidence: .9 }, { requireReviewed: true }), []);
  assert.deepEqual(questionReadinessIssues({ reviewed: true, questionType: "材料分析题", stem: "题干", answer: "答案", knowledgePoints: "民主", answerPoints: "采分点", scoringPoints: "[]", parseConfidence: .9 }, { requireReviewed: true }), []);
  assert.deepEqual(questionReadinessIssues({ reviewed: true, questionType: "判断题", stem: "题干", answer: "正确", knowledgePoints: "宪法", parseConfidence: .5 }, { requireReviewed: true }), ["识别置信度低"]);
});

test("lesson time validation catches inverted time and cancellation without reason", async () => {
  const { validateLessonTime, usesTeachingSlot } = await loadTsModule("app/lib/lesson-validation.ts");
  assert.equal(validateLessonTime({ startTime: "15:00", endTime: "14:00", status: "scheduled" }), "结束时间必须晚于开始时间");
  assert.equal(validateLessonTime({ startTime: "14:00", endTime: "15:00", status: "cancelled" }), "取消课时请填写原因");
  assert.equal(validateLessonTime({ startTime: "14:00", endTime: "15:00", status: "completed" }), null);
  assert.equal(usesTeachingSlot("cancelled"), false);
  assert.equal(usesTeachingSlot("scheduled"), true);
});

test("mastery calculation is explainable and reweights only available evidence", async () => {
  const { calculateMastery } = await loadTsModule("app/lib/mastery.ts");
  const complete = calculateMastery({ assessmentAverage: 80, homeworkCompletionRate: 0.9, understandingAverage: 4, wrongQuestionMasteryRate: 0.5 });
  assert.equal(complete.score, 76);
  assert.equal(complete.components.length, 4);
  assert.equal(complete.components.reduce((sum, item) => sum + item.effectiveWeight, 0), 100);
  const partial = calculateMastery({ assessmentAverage: 75, homeworkCompletionRate: null, understandingAverage: 5, wrongQuestionMasteryRate: null });
  assert.equal(partial.score, 83);
  assert.deepEqual(partial.components.map((item) => item.label), ["测验成绩", "课堂理解"]);
  assert.match(partial.explanation, /缺失项不会按零分处理/);
});

test("assessment validation and statistics stay explainable", async () => {
  const { validateAssessmentResult, assessmentStats } = await loadTsModule("app/lib/assessment.ts");
  assert.equal(validateAssessmentResult({ score: 82, objectiveScore: 42, subjectiveScore: 40 }, 100), null);
  assert.match(validateAssessmentResult({ score: 108 }, 100), /0 到 100/);
  assert.match(validateAssessmentResult({ score: 82, objectiveScore: 50, subjectiveScore: 40 }, 100), /之和应等于总分/);
  const stats = assessmentStats([{ score: 90, weakKnowledge: "法治意识、人民民主" }, { score: 70, weakKnowledge: "法治意识" }, { score: null, weakKnowledge: "" }], 100);
  assert.equal(stats.count, 2); assert.equal(stats.average, 80); assert.equal(stats.rate, 80); assert.deepEqual(stats.weakKnowledge[0], { name: "法治意识", count: 2 });
});

test("teacher daily loop exposes assessment, completion and CSV contracts", async () => {
  const paths = ["app/api/assessments/route.ts", "app/api/assessments/[id]/route.ts", "app/api/lessons/[id]/activity/route.ts", "app/api/exports/[type]/route.ts", "app/assessments/page.tsx", "app/assessments/[id]/page.tsx"];
  const [listApi, detailApi, activity, exportsApi, listPage, detailPage] = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(listApi, /INSERT INTO assessments/); assert.match(detailApi, /ON CONFLICT\(assessment_id,student_id\)/); assert.match(detailApi, /requireAssessmentAccess/);
  assert.match(activity, /saveDraft/); assert.match(activity, /completeLesson/); assert.match(activity, /status: 422/); assert.match(activity, /financeLocked/); assert.match(activity, /NOT EXISTS/); assert.match(exportsApi, /\\uFEFF/); assert.match(exportsApi, /Content-Disposition/); assert.match(exportsApi, /safeCell/);
  assert.match(listPage, /新建测验/); assert.match(detailPage, /批量录入/); assert.match(detailPage, /薄弱知识点/);
});

test("lesson completion requires real content and explicit attendance", async () => {
  const { validateLessonCompletion, completionTodos } = await loadTsModule("app/lib/lesson-workflow.ts");
  assert.deepEqual(validateLessonCompletion("", [1], [{ studentId: 1, attendanceStatus: "present" }]), ["请填写实际教学内容"]);
  assert.deepEqual(validateLessonCompletion("宪法专题复习", [1, 2], [{ studentId: 1, attendanceStatus: "present" }]), ["请确认全部学生出勤（还差 1 人）"]);
  assert.deepEqual(validateLessonCompletion("宪法专题复习", [], []), []);
  assert.deepEqual(validateLessonCompletion("宪法专题复习", [1, 2], [{ studentId: 1, attendanceStatus: "late" }, { studentId: 2, attendanceStatus: "leave" }]), []);
  assert.deepEqual(completionTodos({ assignment: false, feedback: true, nextPlan: "" }), ["补充课后作业", "补充下节课计划"]);
});

test("lesson finance follows source priority and attendance factors", async () => {
  const { attendanceFactor, resolveLessonFinance } = await loadTsModule("app/lib/lesson-workflow.ts");
  assert.equal(attendanceFactor("present"), 1); assert.equal(attendanceFactor("late"), 1); assert.equal(attendanceFactor("absent"), 0); assert.equal(attendanceFactor("leave"), 0);
  const imported = resolveLessonFinance({ date: "2026-07-15", imported: { baseFee: 100, perStudentFee: 50, institution: "__e2e__" }, lessonFee: 999, rules: [{ id: 1, baseFee: 500 }], members: [{ studentId: 1, attendanceStatus: "present" }, { studentId: 2, attendanceStatus: "leave" }] });
  assert.equal(imported.source, "schedule_import"); assert.equal(imported.expectedAmount, 150); assert.deepEqual(imported.items.map((item) => item.amount), [50, 0]);
  const ruled = resolveLessonFinance({ date: "2026-07-15", lessonFee: 999, rules: [{ id: 2, payerType: "parent", baseFee: 20, perStudentFee: 80 }], members: [{ studentId: 1, attendanceStatus: "late" }] });
  assert.equal(ruled.source, "pricing_rule"); assert.equal(ruled.expectedAmount, 100);
  const lessonFee = resolveLessonFinance({ date: "2026-07-15", lessonFee: 120, members: [] });
  assert.equal(lessonFee.source, "lesson_fee"); assert.equal(lessonFee.expectedAmount, 120);
  const missing = resolveLessonFinance({ date: "2026-07-15", members: [] });
  assert.equal(missing.source, "missing_rule"); assert.equal(missing.expectedAmount, 0); assert.match(missing.note, /待补/);
});

test("teacher administrator password policy rejects weak passwords", async () => {
  const { passwordStrengthError, safeReturnPath } = await loadTsModule("app/lib/teacher-auth-policy.ts");
  assert.match(passwordStrengthError("weak-pass"), /至少需要 12 位|过于简单/);
  assert.match(passwordStrengthError("abcdefghijklm"), /字母和数字/);
  assert.equal(passwordStrengthError("Politics2026Secure"), null);
  assert.equal(safeReturnPath("https://evil.example/steal"), "/workspace");
  assert.equal(safeReturnPath("//evil.example/steal"), "/workspace");
  assert.equal(safeReturnPath("/papers?tab=draft"), "/papers?tab=draft");
});

test("teacher administrator security invalidates old sessions and rate-limits failures", async () => {
  const [auth, login, changePassword, settings, settingsPage] = await Promise.all(["app/lib/teacher-auth.ts", "app/api/auth/login/route.ts", "app/api/auth/change-password/route.ts", "app/api/settings/route.ts", "app/settings/page.tsx"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(auth, /sessionVersion/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /teacher_login_attempts/);
  assert.match(login, /status: 429/);
  assert.match(login, /Retry-After/);
  assert.match(changePassword, /otherSessionsInvalidated/);
  assert.match(settings, /accountLabel/);
  assert.doesNotMatch(settingsPage, /ChatGPT 登录邮箱/);
  assert.match(settingsPage, /修改教师管理员密码/);
});

test("sensitive child routes enforce server-side class, student and lesson access", async () => {
  const [access, students, lessons, activity, lessonQuestions, feedback, confirm] = await Promise.all(["app/lib/access.ts", "app/api/students/[id]/route.ts", "app/api/lessons/[id]/route.ts", "app/api/lessons/[id]/activity/route.ts", "app/api/lessons/[id]/questions/route.ts", "app/api/feedback/[id]/route.ts", "app/api/question-sets/[id]/confirm/route.ts"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(access, /staff_class_access/);
  assert.match(access, /requireStudentAccess/);
  assert.match(access, /requireLessonAccess/);
  assert.match(students, /requireStudentAccess/);
  assert.match(lessons, /requireLessonAccess/);
  assert.match(activity, /requireLessonAccess/);
  assert.match(lessonQuestions, /requireLessonAccess/);
  assert.match(feedback, /requireFeedbackAccess/);
  assert.match(confirm, /requirePermission\("questions:write"\)/);
  assert.match(confirm, /reviewedIds/);
});

test("student wrong-question records and feedback delivery stay reviewable", async () => {
  const [schema, route, studentRoute, studentPage, demo, batch, feedbackPage, sentRoute] = await Promise.all(["db/schema.ts", "app/api/students/[id]/wrong-questions/route.ts", "app/api/students/[id]/route.ts", "app/students/[id]/page.tsx", "app/api/settings/demo/route.ts", "app/api/questions/batch/route.ts", "app/feedback/page.tsx", "app/api/feedback/[id]/sent/route.ts"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(schema, /export const wrongQuestions/);
  assert.match(route, /requireStudentAccess/);
  assert.match(route, /requireLessonAccess/);
  assert.match(route, /wrong_questions/);
  assert.match(route, /mastered/);
  assert.match(studentRoute, /wrongQuestions/);
  assert.match(studentPage, /登记错题/);
  assert.match(studentPage, /标记已掌握/);
  assert.match(demo, /wrong_questions/);
  assert.match(demo, /assessment_results/);
  assert.match(demo, /question_sets/);
  assert.match(batch, /action === "delete"/);
  assert.match(batch, /paper_questions/);
  assert.match(schema, /sentAt/);
  assert.match(feedbackPage, /使用.*反馈模板/);
  assert.match(feedbackPage, /标记已发送/);
  assert.match(sentRoute, /requireFeedbackAccess/);
  assert.match(sentRoute, /sent_at/);
});

test("Word review tasks resume from D1 and demo data covers the teaching loop", async () => {
  const [importRoute, setRoute, questionsPage, demo, masteryRoute] = await Promise.all(["app/api/question-sets/import/route.ts", "app/api/question-sets/[id]/route.ts", "app/questions/page.tsx", "app/api/settings/demo/route.ts", "app/api/students/[id]/mastery/route.ts"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(importRoute, /insertedQuestions/);
  assert.match(setRoute, /questionSetId/);
  assert.match(questionsPage, /已恢复.*复核进度/);
  assert.match(questionsPage, /beforeunload/);
  assert.match(questionsPage, /自动保存复核进度失败/);
  for (const status of ["completed", "scheduled", "rescheduled", "cancelled", "makeup"]) assert.match(demo, new RegExp(`\\"${status}\\"`));
  for (const table of ["attendance", "student_lesson_records", "assignments", "assignment_submissions", "lesson_questions", "feedback", "reflections"]) assert.match(demo, new RegExp(table));
  assert.match(masteryRoute, /student_mastery_adjustments/);
  assert.match(masteryRoute, /adjust_mastery/);
});

test("comprehensive demo data is idempotent and covers end-to-end operating states", async () => {
  const scenario = await loadTsModule("app/lib/demo-scenario.ts");
  const [route, settingsPage] = await Promise.all([
    readFile(new URL("../app/api/settings/demo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(scenario.DEMO_SCENARIO_VERSION, "demo-comprehensive-v2");
  assert.ok(scenario.demoLessonScenarios.length >= 12);
  assert.deepEqual(new Set(scenario.demoLessonScenarios.map((item) => item.mode)), new Set(["offline", "online"]));
  assert.ok(new Set(scenario.demoLessonScenarios.map((item) => item.location)).size >= 4);
  for (const status of ["completed", "scheduled", "rescheduled", "cancelled", "makeup"]) assert.ok(scenario.demoLessonScenarios.some((item) => item.status === status));
  for (const status of ["present", "late", "leave", "absent"]) assert.ok(scenario.demoAttendanceStatuses.includes(status));
  for (const status of ["pending", "submitted", "revision", "completed"]) assert.ok(scenario.demoSubmissionStatuses.includes(status));
  for (const status of ["draft", "confirmed", "sent"]) assert.ok(scenario.demoFeedbackStatuses.includes(status));
  for (const type of ["单选题", "多选题", "判断题", "填空题", "简答题", "材料题", "辨析题", "论述题", "探究实践题"]) assert.ok(scenario.demoQuestionScenarios.some((item) => item.type === type));
  assert.ok(scenario.demoResourceScenarios.length >= 3);
  for (const table of ["courses", "assignment_settings", "submission_versions", "feedback_evidence", "lesson_finance", "lesson_billing_items", "settlements", "lesson_packages", "resources", "feedback_templates"]) assert.match(route, new RegExp(table));
  assert.match(route, /entity_type='scenario'/);
  assert.match(route, /alreadyComplete/);
  assert.doesNotMatch(route, /if \(completed\) return/);
  assert.match(route, /course_type=COALESCE\(NULLIF\(TRIM\(course_type\),''\),'小班课'\)/);
  assert.match(route, /trackOnce/);
  assert.match(settingsPage, /核验并补齐演示数据/);
  assert.doesNotMatch(settingsPage, /disabled=\{Boolean\(demoRuns\.length\)\}/);
  assert.match(settingsPage, /logs\.slice\(0, logLimit\)/);
  assert.match(settingsPage, /再显示 30 条/);
});

test("display helpers keep demo identities and due dates readable", async () => {
  const { personInitial, taskDueLabel } = await loadTsModule("app/lib/display-format.ts");
  const { lessonDisplay } = await loadTsModule("app/lib/lesson-display.ts");
  assert.equal(personInitial("【演示】九年级学生1"), "九");
  assert.equal(personInitial("  （莫同学"), "莫");
  assert.equal(personInitial(""), "学");
  assert.equal(taskDueLabel("2026-07-16T21:00", "2026-07-16"), "今天 21:00");
  assert.deepEqual(lessonDisplay({ studentNames: "张同学、李同学", courseType: "一对二", startTime: "18:30", endTime: "20:00", location: "和平校区 A201" }), { studentNames: ["张同学", "李同学"], displaySubject: "张同学、李同学", displayLocation: "和平校区 A201", displayTime: "18:30-20:00", displayTitle: "张同学、李同学——和平校区 A201——18:30-20:00" });
  assert.equal(lessonDisplay({ courseType: "小班课", startTime: "09:00", endTime: "11:00", location: "河西校区" }).displaySubject, "小班课");
  assert.equal(taskDueLabel("2026-07-21T21:00", "2026-07-16"), "7月21日 21:00");
  assert.equal(taskDueLabel("2027-01-02 09:30", "2026-07-16"), "2027年1月2日 09:30");
  assert.equal(taskDueLabel("", "2026-07-16"), "尽快处理");
});

test("class list API returns the camel-case fields consumed by the UI", async () => {
  const route = await readFile(new URL("../app/api/classes/route.ts", import.meta.url), "utf8");
  assert.match(route, /c\.course_type AS courseType/);
  assert.match(route, /c\.start_date AS startDate/);
  assert.doesNotMatch(route, /SELECT c\.\*/);
});

test("student list does not render numeric zero for false database flags", async () => {
  const page = await readFile(new URL("../app/students/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Boolean\(student\.riskConfirmed\) &&/);
  assert.doesNotMatch(page, /\}\{student\.riskConfirmed &&/);
});

test("paper, lesson and public-resource regressions remain covered", async () => {
  const [questionPage, questionApi, paperPage, paperDetail, printCss, lessonRoute, resourceApi, resourcePage] = await Promise.all([
    "app/questions/page.tsx",
    "app/api/questions/route.ts",
    "app/papers/page.tsx",
    "app/papers/[id]/page.tsx",
    "app/content-guide.css",
    "app/api/lessons/route.ts",
    "app/api/resources/route.ts",
    "app/resources/page.tsx",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(questionPage, /value=\{String\(item\)\}>\{item\}级/);
  for (const field of ["textbookVersion", "volume", "unit", "topic"]) {
    assert.match(questionPage, new RegExp(field));
    assert.match(questionApi, new RegExp(field));
    assert.match(paperPage, new RegExp(field));
  }
  assert.match(questionPage, /history\.replaceState/);
  assert.match(questionPage, /清空全部筛选/);
  assert.match(paperPage, /value=\{String\(item\)\}>\{item\}级/);
  assert.match(paperDetail, /window\.print\(\)/);
  assert.match(paperDetail, /updateStatus/);
  assert.match(printCss, /@page/);
  assert.match(printCss, /break-inside:\s*avoid/);
  for (const field of ["courseName", "startTime", "endTime", "className"]) assert.match(lessonRoute, new RegExp(field));
  assert.match(resourceApi, /canWrite/);
  assert.match(resourcePage, /还没有公开资源/);
  assert.match(resourcePage, /canWrite && open/);
});

test("professional political question import preserves review structure", async () => {
  const { parsePoliticsDocx, summarizeImport } = await loadTsModule("app/lib/question-import.ts");
  const [question] = parsePoliticsDocx(`二、材料分析题\n8．【材料】某地开展基层协商。\n【设问】（1）说明协商民主的意义。（2）分析如何保障人民当家作主。\n【答案】坚持党的领导、人民当家作主、依法治国有机统一。\n【采分点】党的领导；人民当家作主；依法治国\n【解析】材料信息与教材观点一一对应。\n【知识点】全过程人民民主\n【难度】4`, { stage: "高中", grade: "高一" });
  assert.equal(question.questionGroup, "二、材料分析题");
  assert.equal(question.subQuestions.length, 2);
  assert.deepEqual(question.scoringPoints, ["党的领导", "人民当家作主", "依法治国"]);
  assert.equal(question.reviewStatus, "pending");
  assert.ok(question.parseConfidence > 0 && question.parseConfidence <= 1);
  assert.equal(summarizeImport([question]).lowConfidence, 0);
});

test("Word import persists original question numbers and uncertainty notes", async () => {
  const [values, importRoute, exportRoute] = await Promise.all([
    "app/api/questions/values.ts",
    "app/api/question-sets/import/route.ts",
    "app/api/papers/[id]/export/route.ts",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(values, /sourceQuestionNumber/);
  assert.match(values, /importNotes/);
  assert.match(values, /原题号/);
  assert.match(values, /importNotesField\(payload\)/);
  assert.match(importRoute, /storeInlineAttachments/);
  assert.match(importRoute, /question-assets/);
  assert.match(importRoute, /env\.FILES\.put/);
  assert.match(exportRoute, /attachment\.storageKey/);
  assert.match(exportRoute, /env\.FILES\.get/);
});

test("question portability, batch review and document export contracts exist", async () => {
  const paths = ["app/api/questions/portable/route.ts", "app/api/questions/batch/route.ts", "app/lib/question-readiness.ts", "app/api/papers/[id]/export/route.ts", "app/papers/[id]/page.tsx", "drizzle/0013_eminent_banshee.sql"];
  const [portable, batch, readiness, docxExport, paperDetail, migration] = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  for (const format of ["csv", "markdown", "json"]) assert.match(portable, new RegExp(format));
  assert.match(portable, /answerIncluded/); assert.match(portable, /import_questions/); assert.match(portable, /status:\s*"review"/);
  for (const action of ["confirm", "return", "ignore", "difficulty", "questionType"]) assert.match(batch, new RegExp(action));
  assert.match(batch, /reviewQuestions/); assert.match(readiness, /识别置信度低/); assert.match(batch, /paper_questions/);
  assert.match(docxExport, /Packer\.toBlob/); assert.match(docxExport, /STHeiti/); assert.match(docxExport, /学生版/); assert.match(docxExport, /解析版/); assert.match(docxExport, /export_jobs/); assert.match(docxExport, /ImageRun/);
  assert.match(paperDetail, /jspdf/); assert.match(paperDetail, /html2canvas/); assert.match(paperDetail, /导出 Word/); assert.match(paperDetail, /导出 PDF/);
  for (const field of ["question_group", "sub_questions", "scoring_points", "attachments", "tables", "parse_confidence", "review_status", "source_document_id", "export_jobs"]) assert.match(migration, new RegExp(field));
});

test("lesson finance keeps attendance factors and settlement differences explicit", async () => {
  const { calculateLessonFinance, defaultBillingFactor, settlementStatus } = await loadTsModule("app/lib/finance.ts");
  assert.equal(defaultBillingFactor("present"), 1); assert.equal(defaultBillingFactor("half"), .5); assert.equal(defaultBillingFactor("leave"), 0); assert.equal(defaultBillingFactor("absent"), 0);
  const result = calculateLessonFinance(100, -10, [{ studentId: 1, status: "present", unitFee: 20 }, { studentId: 2, status: "half", unitFee: 20 }, { studentId: 3, status: "leave", unitFee: 20 }]);
  assert.equal(result.expectedAmount, 120); assert.deepEqual(result.items.map((item) => item.amount), [20, 10, 0]);
  assert.equal(settlementStatus(120, 0), "pending"); assert.equal(settlementStatus(120, 100), "underpaid"); assert.equal(settlementStatus(120, 130), "overpaid"); assert.equal(settlementStatus(120, 120), "settled");
});

test("schedule import recognizes Chinese headers, Excel dates and half-hour slots", async () => {
  const { detectScheduleMapping, normalizeScheduleRow, validateNormalizedSchedule } = await loadTsModule("app/lib/schedule-import.ts");
  const mapping = detectScheduleMapping(["上课日期", "上课时间", "时长", "学生姓名", "课程名称", "上课地点", "底薪", "学生提成"]);
  const row = normalizeScheduleRow({ 上课日期: "2026年7月20日", 上课时间: "8:30", 时长: 1.5, 学生姓名: "小明、小华", 课程名称: "高中政治", 上课地点: "襄阳", 底薪: "100元", 学生提成: "20元" }, mapping);
  assert.equal(row.date, "2026-07-20"); assert.equal(row.startTime, "08:30"); assert.equal(row.endTime, "10:00"); assert.deepEqual(row.studentNames, ["小明", "小华"]); assert.deepEqual(validateNormalizedSchedule(row), []);
});

test("schedule import expands a horizontal calendar matrix without inventing empty lessons", async () => {
  const { detectScheduleMapping, extractCalendarScheduleRows, normalizeScheduleRow, validateNormalizedSchedule } = await loadTsModule("app/lib/schedule-import.ts");
  const table = [
    ["__e2e__教师", "__e2e__教师", "7月27日", "7月28日", "7月29日"],
    ["", "道法", "周一", "周二", "周三"],
    ["", "8–10", "__e2e__初三S班", "", "__e2e__学生"],
    ["", "10:30–12:00", "", "", ""],
  ];
  const rows = extractCalendarScheduleRows(table, "__e2e__课表_2026年7月27日至7月29日.xlsx");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sourceCell), ["C3", "E3"]);
  const mapping = detectScheduleMapping(["上课日期", "上课时间", "结束时间", "学生姓名", "班级", "课程名称"]);
  const normalized = rows.map((row) => normalizeScheduleRow(row.raw, mapping));
  assert.deepEqual(normalized.map((row) => [row.date, row.startTime, row.endTime]), [["2026-07-27", "08:00", "10:00"], ["2026-07-29", "08:00", "10:00"]]);
  assert.equal(normalized[0].className, "__e2e__初三S班");
  assert.deepEqual(normalized[1].studentNames, ["__e2e__学生"]);
  assert.ok(normalized.every((row) => validateNormalizedSchedule(row).length === 0));
});

test("XLSX compatibility reader handles prefixed worksheet XML and shared strings", async () => {
  const { worksheetXmlToTable } = await loadTsModule("app/lib/xlsx-compat.ts");
  const table = worksheetXmlToTable(`<?xml version="1.0"?><x:worksheet xmlns:x="urn:test"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>上课日期</x:v></x:c><x:c r="C1" t="s"><x:v>0</x:v></x:c></x:row><x:row r="2"><x:c r="B2"><x:v>8</x:v></x:c></x:row></x:sheetData></x:worksheet>`, ["周一"]);
  assert.equal(table[0][0], "上课日期");
  assert.equal(table[0][2], "周一");
  assert.equal(table[1][1], 8);
});

test("calendar subscription keeps stable lesson UID and a 30 minute reminder", async () => {
  const { createCalendar } = await loadTsModule("app/lib/calendar.ts");
  const ics = createCalendar([{ id: 12, date: "2026-07-20", startTime: "08:00", endTime: "10:00", courseName: "政治课", topic: "依法治国", location: "教室A", studentNames: "张同学、李同学", courseType: "一对二" }, { id: 13, date: "2026-07-21", startTime: "09:00", endTime: "11:00", courseName: "政治课", location: "教室B", courseType: "小班课" }], 30);
  assert.match(ics, /UID:lesson-12@zhishi-teacher-hub/); assert.match(ics, /TRIGGER:-PT30M/); assert.match(ics, /SUMMARY:张同学\、李同学 · 依法治国/); assert.match(ics, /SUMMARY:小班课 · 政治课/); assert.match(ics, /时间：08:00–10:00/); assert.match(ics, /LOCATION:教室A/); assert.doesNotMatch(ics, /课时费|家长联系方式/);
});

test("recognition blocks uncertain scores and uses four explainable mastery levels", async () => {
  const { canConfirmRecognition, masteryLevel } = await loadTsModule("app/lib/recognition.ts");
  assert.equal(canConfirmRecognition({ confidence: .6, teacherScore: 5, maxScore: 10 }), false); assert.equal(canConfirmRecognition({ confidence: .9, teacherScore: 5, maxScore: 10 }), true); assert.equal(canConfirmRecognition({ reviewStatus: "confirmed", teacherScore: 5, maxScore: 10 }), true); assert.equal(canConfirmRecognition({ confidence: .9, teacherScore: 11, maxScore: 10 }), false);
  assert.equal(masteryLevel(null, 0), "未接触"); assert.equal(masteryLevel(.4, 1), "初步了解"); assert.equal(masteryLevel(.7, 3), "基本掌握"); assert.equal(masteryLevel(.9, 3), "熟练运用");
});

test("new teacher workflows keep private files, mini binding and audit boundaries", async () => {
  const paths = ["db/schema.ts","app/api/files/[id]/route.ts","app/api/schedule-imports/[id]/confirm/route.ts","app/api/finance/route.ts","app/api/recognition/route.ts","app/api/mini/bind/route.ts","app/api/mini/excellent/route.ts","mini-program/README.md","drizzle/0015_teacher_operations.sql"];
  const [schema,files,schedule,finance,recognition,bind,excellent,miniReadme,migration] = await Promise.all(paths.map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  for (const entity of ["scheduleImports","lessonFinance","packageLedger","recognitionJobs","assessmentQuestionResults","parentStudentLinks","submissionVersions","excellentSubmissions"]) assert.match(schema,new RegExp(entity));
  assert.match(files,/requirePermission/); assert.match(files,/private, no-store/); assert.match(schedule,/同名档案/); assert.match(finance,/preview/); assert.match(finance,/confirm/); assert.match(recognition,/仍有.*题存疑/); assert.match(bind,/邀请码无效或已过期/); assert.match(excellent,/masking_status='confirmed'/); assert.match(miniReadme,/生产环境禁止开启/); assert.match(migration,/lesson_finance/);
});
