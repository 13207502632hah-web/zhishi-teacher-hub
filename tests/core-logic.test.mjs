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
  assert.match(confirm, /questions\.reviewed/);
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

test("paper, lesson and public-resource regressions remain covered", async () => {
  const [questionPage, paperPage, paperDetail, printCss, lessonRoute, resourceApi, resourcePage] = await Promise.all([
    "app/questions/page.tsx",
    "app/papers/page.tsx",
    "app/papers/[id]/page.tsx",
    "app/content-guide.css",
    "app/api/lessons/route.ts",
    "app/api/resources/route.ts",
    "app/resources/page.tsx",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(questionPage, /value=\{String\(item\)\}>\{item\}级/);
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
