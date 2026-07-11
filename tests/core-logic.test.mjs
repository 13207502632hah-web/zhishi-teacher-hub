import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
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
