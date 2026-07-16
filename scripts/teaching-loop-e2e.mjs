import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const marker = "__e2e__teaching_loop";
const serveOnly = process.argv.includes("--serve-only");
const e2ePassword = process.env.TEACHING_E2E_PASSWORD || randomBytes(24).toString("base64url");
const e2eSessionSecret = randomBytes(32).toString("base64url");
const devVars = path.join(root, ".dev.vars.e2e");
const reportPath = path.join(root, "outputs", "teaching-loop-e2e.json");
const logs = [];
const aiMock = { mode: "ok", requests: [] };
let server, aiMockServer;

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function aiEnvelope(model, content) {
  return JSON.stringify({
    id: `local-mock-${Date.now()}`,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
    model,
    usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100, completion_tokens: 60, total_tokens: 180 },
  });
}

function aiMockContent(body, payload) {
  if (Array.isArray(payload?.questions)) {
    const reviews = payload.questions.map((question) => {
      let field = "questionType", suggestion = "";
      for (const candidate of payload.safeFields || []) {
        const values = Array.isArray(payload.vocabulary?.[candidate]) ? payload.vocabulary[candidate] : [];
        const different = values.find((value) => String(value) !== String(question[candidate] ?? ""));
        if (different) { field = candidate; suggestion = String(different); break; }
      }
      if (!suggestion) suggestion = String(payload.vocabulary?.[field]?.[0] || question[field] || "单选题");
      return {
        questionId: Number(question.id),
        safeSuggestions: { [field]: suggestion },
        sensitiveSuggestions: { analysis: `【本地模拟审核】请核对题目 ${question.id} 的材料与教材观点对应关系。` },
        confidence: { [field]: 0.93, analysis: 0.78 },
        reasons: { [field]: "该值来自题库现有规范词表，仍需教师查看差异。", analysis: "解析属于敏感字段，只能逐题确认。" },
      };
    });
    return { reviews };
  }
  return {
    classroomSummary: "已根据真实课时记录整理课堂内容。",
    highlights: "能够提取材料关键词并尝试分层表达。",
    consolidate: "需要继续巩固材料信息与教材观点的对应。",
    homeworkSuggestion: "完成配套练习并记录一条错因。",
    nextLessonPlan: "先复测错题，再进入下一知识点。",
    parentMessage: "本次课程已完成既定内容，请按教师记录完成巩固。",
    reflectionOutline: "复盘材料分析步骤与学生规范表述。",
    evidenceSummary: ["课时实际内容", "课堂表现", "作业与出勤记录"],
    uncertainty: [],
  };
}

async function startAiMock() {
  aiMockServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}
    let payload = {};
    try { payload = JSON.parse(body.messages?.find((item) => item.role === "user")?.content || "{}"); } catch {}
    aiMock.requests.push({ body, payload });
    if (aiMock.mode === "http402") { response.writeHead(402, { "Content-Type": "application/json" }); response.end('{"error":"local insufficient balance"}'); return; }
    if (aiMock.mode === "empty") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(aiEnvelope(body.model, {})); return; }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(aiEnvelope(body.model, aiMockContent(body, payload)));
  });
  await new Promise((resolve) => aiMockServer.listen(0, "127.0.0.1", resolve));
  const address = aiMockServer.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      const tables = execFileSync("sqlite3", [full, ".tables"], { encoding: "utf8" });
      if (tables.includes("lessons") && tables.includes("lesson_finance")) return full;
    }
  }
  return null;
}

const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
assert.ok(database?.includes(`${path.sep}.wrangler${path.sep}state${path.sep}`), "只允许使用项目本地 D1");

function sql(statement) {
  return execFileSync("sqlite3", [database, ".timeout 5000", statement], { encoding: "utf8" }).trim();
}

function rows(statement) {
  const output = execFileSync("sqlite3", ["-json", database, ".timeout 5000", statement], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

function cleanup() {
  const lessonIds = `SELECT id FROM lessons WHERE topic LIKE ${quote(`${marker}%`)}`;
  const classIds = `SELECT id FROM classes WHERE name LIKE ${quote(`${marker}%`)}`;
  const studentIds = `SELECT id FROM students WHERE name LIKE ${quote(`${marker}%`)}`;
  const assignmentIds = `SELECT id FROM assignments WHERE lesson_id IN (${lessonIds})`;
  const feedbackIds = `SELECT id FROM feedback WHERE lesson_id IN (${lessonIds}) OR student_id IN (${studentIds})`;
  const financeIds = `SELECT id FROM lesson_finance WHERE lesson_id IN (${lessonIds})`;
  const paperIds = `SELECT id FROM papers WHERE title LIKE ${quote(`%${marker}%`)}`;
  const questionIds = `SELECT id FROM questions WHERE stem LIKE ${quote(`${marker}%`)}`;
  const importIds = `SELECT id FROM schedule_imports WHERE source_name LIKE ${quote(`${marker}%`)}`;
  sql(`PRAGMA foreign_keys=ON;
    DELETE FROM audit_logs WHERE entity_type='lesson' AND CAST(entity_id AS INTEGER) IN (${lessonIds});
    DELETE FROM feedback_evidence WHERE feedback_id IN (${feedbackIds});
    DELETE FROM lesson_completion_runs WHERE lesson_id IN (${lessonIds});
    DELETE FROM lesson_workflow_state WHERE lesson_id IN (${lessonIds});
    DELETE FROM lesson_questions WHERE lesson_id IN (${lessonIds}) OR question_id IN (${questionIds});
    DELETE FROM wrong_questions WHERE student_id IN (${studentIds}) OR question_id IN (${questionIds});
    DELETE FROM sync_events WHERE student_id IN (${studentIds});
    DELETE FROM lesson_billing_items WHERE lesson_finance_id IN (${financeIds});
    DELETE FROM lesson_finance WHERE lesson_id IN (${lessonIds});
    DELETE FROM assignment_assets WHERE assignment_id IN (${assignmentIds});
    DELETE FROM assignment_targets WHERE assignment_id IN (${assignmentIds});
    DELETE FROM assignment_settings WHERE assignment_id IN (${assignmentIds});
    DELETE FROM assignment_submissions WHERE assignment_id IN (${assignmentIds});
    DELETE FROM assignments WHERE lesson_id IN (${lessonIds});
    DELETE FROM feedback WHERE id IN (${feedbackIds});
    DELETE FROM attendance WHERE lesson_id IN (${lessonIds});
    DELETE FROM student_lesson_records WHERE lesson_id IN (${lessonIds});
    DELETE FROM export_jobs WHERE paper_id IN (${paperIds});
    DELETE FROM paper_questions WHERE paper_id IN (${paperIds}) OR question_id IN (${questionIds});
    DELETE FROM paper_files WHERE paper_id IN (${paperIds});
    DELETE FROM papers WHERE id IN (${paperIds}) OR title LIKE ${quote(`${marker}%`)};
    DELETE FROM schedule_import_rows WHERE import_id IN (${importIds});
    DELETE FROM schedule_imports WHERE id IN (${importIds});
    DELETE FROM lessons WHERE id IN (${lessonIds});
    DELETE FROM enrollments WHERE class_id IN (${classIds}) OR student_id IN (${studentIds});
    DELETE FROM pricing_rules WHERE student_id IN (${studentIds});
    DELETE FROM workflow_templates WHERE name LIKE ${quote(`${marker}%`)};
    DELETE FROM questions WHERE id IN (${questionIds});
    DELETE FROM students WHERE id IN (${studentIds});
    DELETE FROM classes WHERE id IN (${classIds});`);
}

function seed(round) {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dueAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 5 * 86_400_000));
  const className = `${marker}_class_${round}`;
  const topic = `${marker}_lesson_${round}`;
  sql(`PRAGMA foreign_keys=ON;
    INSERT INTO classes(name,stage,grade,course_type,status) VALUES(${quote(className)},'高中','高一','一对多','active');
    INSERT INTO students(name,grade,status) VALUES(${quote(`${marker}_student_a_${round}`)},'高一','active');
    INSERT INTO students(name,grade,status) VALUES(${quote(`${marker}_student_b_${round}`)},'高一','active');
    INSERT INTO enrollments(class_id,student_id,status)
      SELECT c.id,s.id,'active' FROM classes c,students s WHERE c.name=${quote(className)} AND s.name LIKE ${quote(`${marker}_student_%_${round}`)};
    INSERT INTO lessons(class_id,date,start_time,end_time,course_name,stage,grade,textbook_version,volume,unit,topic,knowledge_points,teaching_goals,status,fee)
      SELECT id,${quote(today)},'08:00','09:30','道德与法治','高中','高一','统编版','必修3','第一单元',${quote(topic)},'人民民主','完成合成回归','scheduled',999 FROM classes WHERE name=${quote(className)};
    INSERT INTO questions(stem,question_type,stage,grade,textbook_version,volume,unit,topic,knowledge_points,answer,analysis,status,use_count)
      VALUES(${quote(`${marker}_人民民主的本质是什么_${round}`)},'单选题','高中','高一','统编版','必修3','第一单元',${quote(topic)},'人民民主','人民当家作主','来自合成回归的既有解析','active',0);
    INSERT INTO questions(stem,question_type,stage,grade,textbook_version,volume,unit,topic,knowledge_points,answer,analysis,status,use_count)
      VALUES(${quote(`${marker}_人民民主的本质是什么？_${round}`)},'单选题','高中','高一','统编版','必修3','第一单元',${quote(topic)},'人民民主','人民当家作主','来自合成回归的相似题解析','active',0);
    INSERT INTO schedule_imports(source_name,fingerprint,status) VALUES(${quote(`${marker}_import_${round}`)},${quote(`${marker}_fingerprint_${round}`)},'committed');
    INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,lesson_id)
      SELECT i.id,1,'{}',${quote(JSON.stringify({ baseFee: 100, perStudentFee: 50, institution: marker }))},'created',l.id
      FROM schedule_imports i,lessons l WHERE i.source_name=${quote(`${marker}_import_${round}`)} AND l.topic=${quote(topic)};`);
  const lesson = rows(`SELECT id FROM lessons WHERE topic=${quote(topic)}`)[0];
  const students = rows(`SELECT s.id FROM students s JOIN enrollments e ON e.student_id=s.id JOIN lessons l ON l.class_id=e.class_id WHERE l.id=${lesson.id} ORDER BY s.id`);
  assert.equal(students.length, 2);
  sql(`INSERT INTO pricing_rules(student_id,payer_type,base_fee,unit_price,effective_from,effective_to,status) VALUES(${students[0].id},'parent',0,80,${quote(today)},${quote(dueAt)},'active');`);
  const questionIds = rows(`SELECT id FROM questions WHERE stem LIKE ${quote(`${marker}%_${round}`)} ORDER BY id`).map((item) => Number(item.id));
  return { lessonId: Number(lesson.id), studentIds: students.map((item) => Number(item.id)), questionIds, topic, dueAt, today };
}

async function request(pathname, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 300) }; }
  return { response, data };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地服务启动超时：${logs.slice(-8).join("\n")}`);
}

async function login() {
  const unauthenticated = await request("/api/dashboard");
  assert.equal(unauthenticated.response.status, 401);
  const { response, data } = await request("/api/auth/login", { method: "POST", body: { account: marker, password: e2ePassword, returnTo: "/workspace" } });
  assert.equal(response.status, 200, JSON.stringify(data));
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("zhishi_teacher_admin="));
  return cookie;
}

async function exerciseAnonymousAiBoundary() {
  const before = rows(`SELECT
    (SELECT COUNT(*) FROM ai_runs) AS runs,
    (SELECT COUNT(*) FROM ai_feedback_drafts) AS drafts,
    (SELECT COUNT(*) FROM ai_question_review_tasks) AS tasks,
    (SELECT COUNT(*) FROM ai_question_reviews) AS reviews,
    (SELECT COUNT(*) FROM feedback) AS feedback,
    (SELECT COUNT(*) FROM audit_logs) AS audits`)[0];
  const providerCalls = aiMock.requests.length;
  const results = await Promise.all([
    request("/api/ai/feedback-drafts", { method: "POST", body: { lessonId: 1, preview: true } }),
    request("/api/ai/question-reviews"),
    request("/api/ai/question-reviews", { method: "POST", body: { questionIds: [1] } }),
    request("/api/ai/question-reviews/apply", { method: "POST", body: { reviewIds: [1], mode: "single", fields: ["analysis"] } }),
    request("/api/ai/usage"),
    request("/api/settings/ai"),
    request("/api/settings/ai", { method: "PATCH", body: { enabled: true, privacyAcknowledged: true } }),
  ]);
  for (const result of results) {
    assert.equal(result.response.status, 401, JSON.stringify(result.data));
    assert.match(String(result.data?.error || ""), /教师管理员账号登录/);
  }
  assert.equal(aiMock.requests.length, providerCalls);
  const after = rows(`SELECT
    (SELECT COUNT(*) FROM ai_runs) AS runs,
    (SELECT COUNT(*) FROM ai_feedback_drafts) AS drafts,
    (SELECT COUNT(*) FROM ai_question_review_tasks) AS tasks,
    (SELECT COUNT(*) FROM ai_question_reviews) AS reviews,
    (SELECT COUNT(*) FROM feedback) AS feedback,
    (SELECT COUNT(*) FROM audit_logs) AS audits`)[0];
  assert.deepEqual(after, before);
  return { endpoints: results.length, rejected: true, providerCalls: 0, databaseWrites: 0 };
}

async function exerciseComprehensiveDemo(cookie) {
  const first = await request("/api/settings/demo", { cookie, method: "POST" });
  assert.ok([200, 201].includes(first.response.status), JSON.stringify({ status: first.response.status, data: first.data, logs: logs.slice(-20) }));
  assert.ok(first.data.summary.classes >= 2);
  assert.ok(first.data.summary.students >= 10);
  assert.ok(first.data.summary.lessons >= 12);
  assert.ok(first.data.summary.questions >= 40);
  assert.ok(first.data.summary.papers >= 3);
  assert.ok(first.data.summary.assignments >= 7);
  assert.ok(first.data.summary.submissions >= 35);
  assert.ok(first.data.summary.finance >= 6);
  assert.ok(first.data.summary.resources >= 3);

  const repairTarget = rows("SELECT c.id FROM classes c JOIN demo_records d ON d.entity_type='class' AND d.entity_id=c.id ORDER BY c.id LIMIT 1")[0];
  assert.ok(repairTarget?.id);
  sql(`UPDATE classes SET course_type='' WHERE id=${Number(repairTarget.id)}`);
  const repeated = await request("/api/settings/demo", { cookie, method: "POST" });
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.data));
  assert.equal(repeated.data.mode, "verified");
  assert.deepEqual(repeated.data.summary, first.data.summary);
  const repairedClass = rows(`SELECT course_type AS courseType FROM classes WHERE id=${Number(repairTarget.id)}`)[0];
  assert.equal(repairedClass.courseType, "小班课");
  const classesView = await request("/api/classes?status=active", { cookie });
  assert.equal(classesView.response.status, 200, JSON.stringify(classesView.data));
  const demoClasses = classesView.data.classes.filter((item) => String(item.name || "").startsWith("【演示】"));
  assert.ok(demoClasses.length >= 2);
  assert.ok(demoClasses.every((item) => item.courseType === "小班课"));

  const coverage = rows(`SELECT
    (SELECT COUNT(DISTINCT l.location) FROM lessons l JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=l.id) AS locations,
    (SELECT COUNT(DISTINCT l.mode) FROM lessons l JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=l.id) AS lessonModes,
    (SELECT COUNT(DISTINCT l.status) FROM lessons l JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=l.id) AS lessonStatuses,
    (SELECT COUNT(DISTINCT a.status) FROM attendance a JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=a.lesson_id) AS attendanceStatuses,
    (SELECT COUNT(DISTINCT s.status) FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=a.lesson_id) AS submissionStatuses,
    (SELECT COUNT(DISTINCT f.status) FROM feedback f JOIN demo_records d ON d.entity_type='feedback' AND d.entity_id=f.id) AS feedbackStatuses,
    (SELECT COUNT(DISTINCT q.question_type) FROM questions q JOIN demo_records d ON d.entity_type='question' AND d.entity_id=q.id) AS questionTypes,
    (SELECT COUNT(*) FROM resources r JOIN demo_records d ON d.entity_type='resource' AND d.entity_id=r.id WHERE r.visibility='private') AS privateResources`)[0];
  assert.ok(coverage.locations >= 4, JSON.stringify(coverage));
  assert.equal(coverage.lessonModes, 2);
  assert.ok(coverage.lessonStatuses >= 5);
  assert.ok(coverage.attendanceStatuses >= 4);
  assert.ok(coverage.submissionStatuses >= 4);
  assert.equal(coverage.feedbackStatuses, 3);
  assert.ok(coverage.questionTypes >= 9);
  assert.ok(coverage.privateResources >= 3);

  for (const pathname of ["/api/dashboard", "/api/analytics?range=month", "/api/classes", "/api/students", "/api/lessons", "/api/assignments", "/api/questions?status=active", "/api/papers", "/api/feedback", "/api/assessments", "/api/finance", "/api/resources"]) {
    const result = await request(pathname, { cookie });
    assert.equal(result.response.status, 200, `${pathname}: ${JSON.stringify(result.data)}`);
  }
  const dashboard = await request("/api/dashboard?days=30", { cookie });
  const displayedLesson = [...(dashboard.data.todayLessons || []), ...(dashboard.data.upcomingLessons || [])].find((item) => String(item.displaySubject || "").startsWith("【演示】"));
  assert.ok(displayedLesson?.studentNames?.length, JSON.stringify(displayedLesson));
  assert.ok(displayedLesson.displaySubject);
  assert.match(String(displayedLesson.displayTime || ""), /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/);
  assert.ok(displayedLesson.displayLocation);
  const calendarSubscription = await request("/api/calendar/subscription", { cookie, method: "POST" });
  assert.equal(calendarSubscription.response.status, 200, JSON.stringify(calendarSubscription.data));
  const calendarFeed = await fetch(`${baseUrl}${String(calendarSubscription.data.path || "")}`), calendarText = await calendarFeed.text();
  assert.equal(calendarFeed.status, 200, calendarText.slice(0, 300));
  assert.match(calendarText, new RegExp(String(displayedLesson.displaySubject).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(calendarText, /时间：\d{2}:\d{2}–\d{2}:\d{2}/);
  assert.match(calendarText, new RegExp(String(displayedLesson.displayLocation).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const question = rows("SELECT q.id,q.answer,q.analysis FROM questions q JOIN demo_records d ON d.entity_type='question' AND d.entity_id=q.id WHERE TRIM(COALESCE(q.answer,''))<>'' AND TRIM(COALESCE(q.analysis,''))<>'' ORDER BY q.id LIMIT 1")[0];
  assert.ok(question?.id);
  const content = await request(`/api/questions/${Number(question.id)}/content`, { cookie });
  assert.equal(content.response.status, 200, JSON.stringify(content.data));
  assert.equal(content.data.content.answer, question.answer);
  assert.equal(content.data.content.analysis, question.analysis);
  assert.match(content.response.headers.get("cache-control") || "", /no-store/);
  return { summary: first.data.summary, coverage, idempotent: true, questionContent: true, scheduleDisplay: true, calendarDisplay: true };
}

async function exerciseAiWorkflows(cookie) {
  const teacher = rows("SELECT id FROM users WHERE email='teacher-admin@local.invalid' LIMIT 1")[0];
  assert.ok(teacher?.id);
  const userId = Number(teacher.id), sqlValue = (value) => value == null ? "NULL" : quote(value), maxId = (table) => Number(rows(`SELECT COALESCE(MAX(id),0) AS id FROM ${table}`)[0]?.id || 0);
  const previousSettings = rows(`SELECT enabled,include_student_name AS includeStudentName,privacy_ack_at AS privacyAckAt,daily_limit AS dailyLimit,emergency_disabled AS emergencyDisabled,fast_model AS fastModel,deep_model AS deepModel FROM ai_settings WHERE user_id=${userId}`)[0] || null;
  const baseline = { run: maxId("ai_runs"), draft: maxId("ai_feedback_drafts"), learning: maxId("ai_feedback_learning_events"), review: maxId("ai_question_reviews"), feedback: maxId("feedback"), audit: maxId("audit_logs") };
  const taskIds = new Set(), questionRestores = new Map();
  const safeColumns = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level" };
  const restoreQuestion = (id, column = null) => {
    if (questionRestores.has(id)) return;
    const selected = column ? `,${column} AS safeValue` : "";
    const original = rows(`SELECT id,analysis,updated_at AS updatedAt${selected} FROM questions WHERE id=${Number(id)}`)[0];
    assert.ok(original?.id);
    questionRestores.set(Number(id), { ...original, column });
  };
  const restoreLocalState = () => {
    for (const original of questionRestores.values()) {
      const safe = original.column ? `${original.column}=${sqlValue(original.safeValue)},` : "";
      sql(`UPDATE questions SET ${safe}analysis=${sqlValue(original.analysis)},updated_at=${sqlValue(original.updatedAt)} WHERE id=${Number(original.id)}`);
    }
    const tasks = [...taskIds].map(sqlValue).join(",") || "NULL";
    sql(`PRAGMA foreign_keys=ON;
      DELETE FROM ai_feedback_learning_events WHERE id>${baseline.learning};
      DELETE FROM ai_feedback_drafts WHERE id>${baseline.draft};
      DELETE FROM feedback_evidence WHERE feedback_id>${baseline.feedback};
      DELETE FROM feedback WHERE id>${baseline.feedback};
      DELETE FROM ai_question_reviews WHERE id>${baseline.review};
      DELETE FROM ai_question_review_tasks WHERE id IN (${tasks});
      DELETE FROM ai_runs WHERE id>${baseline.run};
      DELETE FROM audit_logs WHERE id>${baseline.audit};`);
    if (previousSettings) sql(`INSERT INTO ai_settings(user_id,enabled,include_student_name,privacy_ack_at,daily_limit,emergency_disabled,fast_model,deep_model,updated_at) VALUES(${userId},${Number(previousSettings.enabled || 0)},${Number(previousSettings.includeStudentName || 0)},${sqlValue(previousSettings.privacyAckAt)},${Number(previousSettings.dailyLimit || 50)},${Number(previousSettings.emergencyDisabled || 0)},${sqlValue(previousSettings.fastModel)},${sqlValue(previousSettings.deepModel)},CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,include_student_name=excluded.include_student_name,privacy_ack_at=excluded.privacy_ack_at,daily_limit=excluded.daily_limit,emergency_disabled=excluded.emergency_disabled,fast_model=excluded.fast_model,deep_model=excluded.deep_model,updated_at=CURRENT_TIMESTAMP`);
    else sql(`DELETE FROM ai_settings WHERE user_id=${userId}`);
  };

  aiMock.mode = "ok";
  aiMock.requests.length = 0;
  sql(`DELETE FROM ai_settings WHERE user_id=${userId}`);
  try {
    const lesson = rows("SELECT l.id,l.class_id AS classId FROM lessons l JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=l.id WHERE l.status IN ('completed','makeup') AND TRIM(COALESCE(l.actual_content,''))<>'' ORDER BY l.id LIMIT 1")[0];
    assert.ok(lesson?.id);
    const student = rows(`SELECT s.id,s.name FROM students s JOIN enrollments e ON e.student_id=s.id WHERE e.class_id=${Number(lesson.classId)} AND e.status='active' ORDER BY s.id LIMIT 1`)[0];
    assert.ok(student?.id);
    const feedbackInput = { lessonId: Number(lesson.id), studentId: Number(student.id), audience: "private", tone: "温和鼓励", customInput: "仅作本地隐私测试：手机 13800138000，微信号 wxTeacher88，附件 /tmp/private.pdf" };

    let result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { enabled: true, includeStudentName: true, dailyLimit: 50, emergencyDisabled: false, privacyAcknowledged: false } });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    let providerCalls = aiMock.requests.length;
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.response.status, 409, JSON.stringify(result.data));
    assert.equal(result.data.code, "PRIVACY_ACK_REQUIRED");
    assert.equal(aiMock.requests.length, providerCalls);

    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { enabled: false, includeStudentName: true, dailyLimit: 50, emergencyDisabled: false, privacyAcknowledged: true } });
    assert.equal(result.response.status, 200);
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.data.code, "AI_DISABLED");
    assert.equal(aiMock.requests.length, providerCalls);
    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { enabled: true, includeStudentName: true, dailyLimit: 50, emergencyDisabled: true } });
    assert.equal(result.response.status, 200);
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.data.code, "AI_DISABLED");
    assert.equal(aiMock.requests.length, providerCalls);
    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { enabled: true, includeStudentName: true, dailyLimit: 50, emergencyDisabled: false } });
    assert.equal(result.response.status, 200);

    const preview = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: { ...feedbackInput, preview: true } });
    assert.equal(preview.response.status, 200, JSON.stringify(preview.data));
    assert.equal(aiMock.requests.length, providerCalls);
    assert.ok(preview.data.sentFields.includes("学生姓名"));
    for (const label of ["监护人联系方式", "微信标识", "附件原件与文件地址", "登录、会话和密钥数据"]) assert.ok(preview.data.excludedFields.includes(label));

    const generated = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(generated.response.status, 200, JSON.stringify(generated.data));
    const feedbackRequest = aiMock.requests.at(-1);
    assert.equal(feedbackRequest.body.model, "deepseek-v4-flash");
    assert.equal(feedbackRequest.body.thinking.type, "disabled");
    const capturedFeedback = JSON.stringify(feedbackRequest.body);
    for (const secret of ["13800138000", "wxTeacher88", "/tmp/private.pdf"]) assert.doesNotMatch(capturedFeedback, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const draft = generated.data.draft, styleMarker = "【本地风格】先回扣材料关键词，再按观点—材料—结论分层表达。";
    result = await request("/api/feedback", { cookie, method: "POST", body: { ...draft, lessonId: Number(lesson.id), studentId: Number(student.id), classId: Number(lesson.classId), aiDraftId: Number(draft.aiDraftId), aiReviewed: true, type: "lesson", audience: "private", tone: "温和鼓励", status: "draft", content: styleMarker, parentAdvice: styleMarker } });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));

    let settings = await request("/api/settings/ai", { cookie });
    assert.equal(settings.response.status, 200);
    assert.ok(Number(settings.data.learning?.activeCount || 0) >= 1);
    const learningRecord = settings.data.learningRecords.find((item) => Number(item.feedbackId) === Number(result.data.feedback.id));
    assert.ok(learningRecord?.id);

    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const learnedRequest = aiMock.requests.at(-1);
    assert.match(JSON.stringify(learnedRequest.payload.teacherStyleExamples || []), /本地风格/);
    assert.doesNotMatch(JSON.stringify(learnedRequest.payload.teacherStyleExamples || []), new RegExp(String(student.name)));
    await request("/api/ai/feedback-drafts", { cookie, method: "DELETE", body: { id: result.data.draft.aiDraftId } });

    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { action: "setLearningActive", id: Number(learningRecord.id), active: false } });
    assert.equal(result.response.status, 200);
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const disabledLearningRequest = aiMock.requests.at(-1);
    assert.doesNotMatch(JSON.stringify(disabledLearningRequest.payload.teacherStyleExamples || []), /本地风格/);
    await request("/api/ai/feedback-drafts", { cookie, method: "DELETE", body: { id: result.data.draft.aiDraftId } });
    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { action: "clearLearning" } });
    assert.equal(Number(result.data.learning?.count || 0), 0);

    const unchangedBefore = rows(`SELECT (SELECT COUNT(*) FROM lessons) AS lessons,(SELECT COUNT(*) FROM assignments) AS assignments,(SELECT COUNT(*) FROM feedback) AS feedback`)[0];
    aiMock.mode = "http402";
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    aiMock.mode = "ok";
    assert.equal(result.response.status, 502, JSON.stringify(result.data));
    assert.equal(result.data.code, "HTTP_402");
    const unchangedAfter = rows(`SELECT (SELECT COUNT(*) FROM lessons) AS lessons,(SELECT COUNT(*) FROM assignments) AS assignments,(SELECT COUNT(*) FROM feedback) AS feedback`)[0];
    assert.deepEqual(unchangedAfter, unchangedBefore);

    const questionIds = rows("SELECT q.id FROM questions q JOIN demo_records d ON d.entity_type='question' AND d.entity_id=q.id LEFT JOIN ai_question_reviews r ON r.question_id=q.id WHERE r.id IS NULL ORDER BY q.id LIMIT 13").map((item) => Number(item.id));
    assert.equal(questionIds.length, 13);
    const firstBatch = await request("/api/ai/question-reviews", { cookie, method: "POST", body: { questionIds: questionIds.slice(0, 12) } });
    assert.equal(firstBatch.response.status, 200, JSON.stringify(firstBatch.data));
    assert.equal(firstBatch.data.processed, 10);
    assert.equal(firstBatch.data.task.status, "queued");
    taskIds.add(String(firstBatch.data.task.id));
    const secondBatch = await request("/api/ai/question-reviews", { cookie, method: "POST", body: { taskId: firstBatch.data.task.id } });
    assert.equal(secondBatch.response.status, 200, JSON.stringify(secondBatch.data));
    assert.equal(secondBatch.data.processed, 2);
    assert.equal(secondBatch.data.task.status, "completed");
    const batchRequests = aiMock.requests.filter((item) => Array.isArray(item.payload?.questions) && item.body.model === "deepseek-v4-flash");
    assert.equal(batchRequests.length, 2);
    assert.ok(batchRequests.every((item) => item.body.thinking.type === "enabled" && item.payload.questions.length <= 10));

    const deepReview = await request("/api/ai/question-reviews", { cookie, method: "POST", body: { questionIds: [questionIds[12]], deepReview: true } });
    assert.equal(deepReview.response.status, 200, JSON.stringify(deepReview.data));
    assert.equal(deepReview.data.task.status, "completed");
    taskIds.add(String(deepReview.data.task.id));
    const proRequest = aiMock.requests.at(-1);
    assert.equal(proRequest.body.model, "deepseek-v4-pro");
    assert.equal(proRequest.body.thinking.type, "enabled");
    assert.equal(proRequest.payload.questions.length, 1);

    const reviewList = await request("/api/ai/question-reviews", { cookie });
    assert.equal(reviewList.response.status, 200);
    const taskReviews = reviewList.data.reviews.filter((item) => String(item.taskId) === String(firstBatch.data.task.id));
    assert.equal(taskReviews.length, 12);
    const eligible = taskReviews.find((item) => item.eligibleFields?.length && item.sensitiveSuggestions?.analysis);
    assert.ok(eligible);
    const safeField = String(eligible.eligibleFields[0]), safeColumn = safeColumns[safeField];
    assert.ok(safeColumn);
    restoreQuestion(Number(eligible.questionId), safeColumn);
    const beforeApply = rows(`SELECT ${safeColumn} AS safeValue,analysis FROM questions WHERE id=${Number(eligible.questionId)}`)[0];
    result = await request("/api/ai/question-reviews/apply", { cookie, method: "POST", body: { reviewIds: [eligible.id], mode: "batch" } });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.applied.length, 1);
    let afterApply = rows(`SELECT ${safeColumn} AS safeValue,analysis FROM questions WHERE id=${Number(eligible.questionId)}`)[0];
    assert.equal(afterApply.safeValue, eligible.safeSuggestions[safeField]);
    assert.equal(afterApply.analysis, beforeApply.analysis);
    result = await request("/api/ai/question-reviews/apply", { cookie, method: "POST", body: { reviewIds: [eligible.id], mode: "single", fields: ["analysis"] } });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    afterApply = rows(`SELECT analysis FROM questions WHERE id=${Number(eligible.questionId)}`)[0];
    assert.equal(afterApply.analysis, eligible.sensitiveSuggestions.analysis);

    const staleReview = taskReviews.find((item) => Number(item.id) !== Number(eligible.id) && item.sensitiveSuggestions?.analysis);
    assert.ok(staleReview);
    restoreQuestion(Number(staleReview.questionId));
    const staleBefore = rows(`SELECT analysis FROM questions WHERE id=${Number(staleReview.questionId)}`)[0];
    sql(`UPDATE questions SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=${Number(staleReview.questionId)}`);
    result = await request("/api/ai/question-reviews/apply", { cookie, method: "POST", body: { reviewIds: [staleReview.id], mode: "single", fields: ["analysis"] } });
    assert.ok(result.data.stale.includes(Number(staleReview.id)), JSON.stringify(result.data));
    assert.equal(rows(`SELECT analysis FROM questions WHERE id=${Number(staleReview.questionId)}`)[0].analysis, staleBefore.analysis);

    const deepPending = reviewList.data.reviews.find((item) => String(item.taskId) === String(deepReview.data.task.id));
    assert.ok(deepPending?.id);
    result = await request("/api/ai/question-reviews/apply", { cookie, method: "POST", body: { reviewIds: [deepPending.id], mode: "single", fields: ["analysis"], action: "reject" } });
    assert.equal(result.data.rejected, 1);

    providerCalls = aiMock.requests.length;
    result = await request("/api/settings/ai", { cookie, method: "PATCH", body: { enabled: true, includeStudentName: true, dailyLimit: 1, emergencyDisabled: false } });
    assert.equal(result.response.status, 200);
    result = await request("/api/ai/feedback-drafts", { cookie, method: "POST", body: feedbackInput });
    assert.equal(result.response.status, 429, JSON.stringify(result.data));
    assert.equal(result.data.code, "DAILY_LIMIT");
    assert.equal(aiMock.requests.length, providerCalls);

    const usage = await request("/api/ai/usage", { cookie });
    assert.equal(usage.response.status, 200);
    assert.ok(Number(usage.data.today?.calls || 0) >= 6);
    assert.ok(Number(usage.data.month?.tokens || 0) > 0);
    const auditActions = new Set(rows(`SELECT action FROM audit_logs WHERE id>${baseline.audit}`).map((item) => String(item.action)));
    for (const action of ["generate", "generate_failed", "apply_ai_suggestion", "reject", "delete_all"]) assert.ok(auditActions.has(action), `缺少 AI 审计动作 ${action}`);

    return { mockedProviderCalls: aiMock.requests.length, feedbackDraft: true, privacyPreflight: true, learningLifecycle: true, failureIsolation: true, questionBatch: { total: 12, batches: 2, resumable: true }, proSingleReview: true, staleProtection: true, usageRecorded: true };
  } finally {
    aiMock.mode = "ok";
    restoreLocalState();
  }
}

async function exerciseRound(round, cookie) {
  cleanup();
  const { lessonId, studentIds, questionIds, topic, dueAt, today } = seed(round);
  assert.equal(questionIds.length, 2);
  for (const days of [7, 14, 30]) {
    const dashboard = await request(`/api/dashboard?days=${days}`, { cookie });
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.data.horizonDays, days);
    assert.ok(dashboard.data.suggestedActions.length <= 3);
    assert.ok(dashboard.data.todayLessons.some((lesson) => lesson.id === lessonId && lesson.topic === topic));
  }

  let result = await request(`/api/lessons/${lessonId}/workflow-state`, { cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.state.revision, 0);
  result = await request(`/api/lessons/${lessonId}/workflow-state`, { cookie, method: "PUT", body: { revision: 0, payload: { closure: { actualContent: `${marker}_autosave_${round}` } } } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.revision, 1);
  const conflict = await request(`/api/lessons/${lessonId}/workflow-state`, { cookie, method: "PUT", body: { revision: 0, payload: { closure: { actualContent: "旧页面覆盖" } } } });
  assert.equal(conflict.response.status, 409);

  const prep = await request(`/api/lessons/${lessonId}/prep`, { cookie });
  assert.equal(prep.response.status, 200, JSON.stringify(prep.data));
  assert.ok(prep.data.recommendedQuestions.some((question) => question.id === questionIds[0] && question.score === 100));
  result = await request(`/api/lessons/${lessonId}/prep`, { cookie, method: "PATCH", body: { teachingGoals: "教师填写目标", keyPoints: "教师填写重点", difficultPoints: "教师填写难点", materials: "教材与既有讲义", knowledgePoints: "人民民主" } });
  assert.equal(result.response.status, 200);

  const stats = await request("/api/questions/stats?stage=高中&grade=高一&knowledge=人民民主", { cookie });
  assert.equal(stats.response.status, 200);
  assert.ok(stats.data.summary.total >= 2);
  const similar = await request(`/api/questions/${questionIds[0]}/similar`, { cookie });
  assert.equal(similar.response.status, 200);
  assert.ok(similar.data.similar.some((question) => question.id === questionIds[1]));

  result = await request(`/api/lessons/${lessonId}/questions/batch`, { cookie, method: "POST", body: { questionIds: [questionIds[0]], purpose: "课堂练习" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.linked, 1);
  result = await request(`/api/lessons/${lessonId}/questions/batch`, { cookie, method: "POST", body: { questionIds: [questionIds[0]], purpose: "课堂练习" } });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.linked, 0);

  const homework = await request(`/api/lessons/${lessonId}/homework-draft`, { cookie, method: "POST", body: { questionIds } });
  assert.equal(homework.response.status, 200, JSON.stringify(homework.data));
  assert.equal(homework.data.added, 2);
  const homeworkAgain = await request(`/api/lessons/${lessonId}/homework-draft`, { cookie, method: "POST", body: { questionIds } });
  assert.equal(homeworkAgain.response.status, 200);
  assert.equal(homeworkAgain.data.paperId, homework.data.paperId);
  assert.equal(homeworkAgain.data.assignmentId, homework.data.assignmentId);
  assert.equal(homeworkAgain.data.added, 0);
  let benchmarkMs = null;
  if (round === 1) {
    for (const mode of ["student", "analysis"]) {
      const exported = await request(`/api/papers/${homework.data.paperId}/export?mode=${mode}`, { cookie });
      assert.equal(exported.response.status, 200);
      assert.match(exported.response.headers.get("content-type") || "", /wordprocessingml/);
    }
  }

  const templateName = `${marker}_template_${round}`;
  result = await request("/api/workflow-templates", { cookie, method: "POST", body: { type: "next_plan", name: templateName, payload: { nextPlan: "复习已有记录" } } });
  assert.equal(result.response.status, 201);
  const templateId = Number(result.data.id);
  result = await request("/api/workflow-templates?type=next_plan", { cookie });
  assert.ok(result.data.templates.some((item) => item.id === templateId));

  const baseRecords = [
    { studentId: studentIds[0], attendanceStatus: "present", participation: 5, understanding: 4, completion: 5 },
    { studentId: studentIds[1], attendanceStatus: "leave", participation: 3, understanding: 3, completion: 3 },
  ];
  result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "completeLesson", actualContent: "", records: baseRecords } });
  assert.equal(result.response.status, 422);
  result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "completeLesson", actualContent: "人民民主专题", records: baseRecords.slice(0, 1) } });
  assert.equal(result.response.status, 422);

  const payload = {
    action: "saveDraft", actualContent: "人民民主专题", homework: "完成巩固练习", nextPlan: "",
    participation: 4, understanding: 4, completion: 4, discipline: 5, records: baseRecords,
  };
  result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: payload });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(rows(`SELECT status FROM lessons WHERE id=${lessonId}`)[0].status, "scheduled");

  const completion = {
    ...payload, action: "completeLesson",
    assignment: { title: `${topic} 课后作业`, requirements: "完成合成练习", dueAt },
    feedback: { tone: "专业简洁", content: `${marker}_feedback_${round}` },
  };
  const first = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: completion });
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, "completed");
  assert.deepEqual(first.data.todos, ["补充下节课计划"]);
  const undo = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "undoLatestCompletion" } });
  assert.equal(undo.response.status, 200, JSON.stringify(undo.data));
  const afterUndo = rows(`SELECT l.status,l.actual_content AS actualContent,(SELECT COUNT(*) FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.lesson_id=l.id) AS submissions,(SELECT COUNT(*) FROM feedback WHERE lesson_id=l.id) AS feedback,(SELECT COUNT(*) FROM lesson_finance WHERE lesson_id=l.id) AS finance FROM lessons l WHERE l.id=${lessonId}`)[0];
  assert.deepEqual({ status: afterUndo.status, actualContent: afterUndo.actualContent, submissions: afterUndo.submissions, feedback: afterUndo.feedback, finance: afterUndo.finance }, { status: "scheduled", actualContent: "人民民主专题", submissions: 0, feedback: 0, finance: 0 });

  const completedAgain = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: completion });
  assert.equal(completedAgain.response.status, 200, JSON.stringify(completedAgain.data));
  const second = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: completion });
  assert.equal(second.response.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.idempotent, true);

  const counts = rows(`SELECT
    (SELECT COUNT(*) FROM assignments WHERE lesson_id=${lessonId}) AS assignments,
    (SELECT COUNT(*) FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.lesson_id=${lessonId}) AS submissions,
    (SELECT COUNT(*) FROM feedback WHERE lesson_id=${lessonId}) AS feedback,
    (SELECT COUNT(*) FROM lesson_finance WHERE lesson_id=${lessonId}) AS finance,
    (SELECT COUNT(*) FROM lesson_billing_items b JOIN lesson_finance f ON f.id=b.lesson_finance_id WHERE f.lesson_id=${lessonId}) AS billing,
    (SELECT COUNT(*) FROM attendance WHERE lesson_id=${lessonId}) AS attendance,
    (SELECT expected_amount FROM lesson_finance WHERE lesson_id=${lessonId}) AS expectedAmount`)[0];
  assert.deepEqual({ assignments: counts.assignments, submissions: counts.submissions, feedback: counts.feedback, finance: counts.finance, billing: counts.billing, attendance: counts.attendance }, { assignments: 1, submissions: 2, feedback: 1, finance: 1, billing: 2, attendance: 2 });
  assert.equal(Number(counts.expectedAmount), 150);

  const adjustmentWithoutReason = await request("/api/finance", { cookie, method: "POST", body: { action: "preview", lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 10 } });
  assert.equal(adjustmentWithoutReason.response.status, 422);
  const financePreview = await request("/api/finance", { cookie, method: "POST", body: { action: "preview", lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 0 } });
  assert.equal(financePreview.response.status, 200, JSON.stringify(financePreview.data));
  assert.equal(financePreview.data.context.canConfirm, true);
  assert.equal(financePreview.data.preview.expectedAmount, 80);
  const financeConfirm = await request("/api/finance", { cookie, method: "POST", body: { action: "confirm", lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 0 } });
  assert.equal(financeConfirm.response.status, 200, JSON.stringify(financeConfirm.data));
  assert.equal(financeConfirm.data.calculation.expectedAmount, 80);

  const feedbackSummary = await request(`/api/feedback/summary?studentId=${studentIds[0]}&start=${today}&end=${today}`, { cookie });
  assert.equal(feedbackSummary.response.status, 200);
  const noEvidence = await request("/api/feedback", { cookie, method: "POST", body: { type: "stage", studentId: studentIds[0], content: `${marker}_stage_${round}`, status: "confirmed" } });
  assert.equal(noEvidence.response.status, 422);
  const evidenced = await request("/api/feedback", { cookie, method: "POST", body: { type: "stage", studentId: studentIds[0], content: `${marker}_stage_${round}`, status: "confirmed", evidenceRefs: feedbackSummary.data.draft.evidenceRefs } });
  assert.equal(evidenced.response.status, 201, JSON.stringify(evidenced.data));

  sql(`UPDATE students SET risk_confirmed=1,risk_tags=${quote(`${marker}_teacher_confirmed`)} WHERE id=${studentIds[0]};
    UPDATE feedback SET status='confirmed',content=${quote(`${marker}_confirmed_${round}`)} WHERE lesson_id=${lessonId};`);
  const protectedRun = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { ...completion, actualContent: "重复完成后的内容", feedback: { content: `${marker}_must_not_overwrite_${round}` } } });
  assert.equal(protectedRun.response.status, 200, JSON.stringify(protectedRun.data));
  assert.equal(protectedRun.data.artifacts.financeLocked, true);
  const blockedUndo = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "undoLatestCompletion" } });
  assert.equal(blockedUndo.response.status, 409);
  assert.ok(blockedUndo.data.blockers.length >= 1);
  const protectedRows = rows(`SELECT
    (SELECT COUNT(*) FROM feedback WHERE lesson_id=${lessonId}) AS feedbackCount,
    (SELECT content FROM feedback WHERE lesson_id=${lessonId}) AS feedbackContent,
    (SELECT status FROM lesson_finance WHERE lesson_id=${lessonId}) AS financeStatus,
    (SELECT pricing_rule_id FROM lesson_finance WHERE lesson_id=${lessonId}) AS pricingRuleId,
    (SELECT calculation_snapshot FROM lesson_finance WHERE lesson_id=${lessonId}) AS calculationSnapshot`)[0];
  assert.equal(protectedRows.feedbackCount, 1);
  assert.equal(protectedRows.feedbackContent, `${marker}_confirmed_${round}`);
  assert.equal(protectedRows.financeStatus, "pending");
  assert.ok(protectedRows.pricingRuleId);
  assert.match(protectedRows.calculationSnapshot, /expectedAmount/);

  const attention = await request("/api/students/attention", { cookie });
  assert.equal(attention.response.status, 200);
  assert.ok(attention.data.students.some((student) => student.id === studentIds[0]));
  const insights = await request(`/api/students/${studentIds[0]}/insights?weeks=4`, { cookie });
  assert.equal(insights.response.status, 200);
  assert.ok(insights.data.timeline.some((item) => item.type === "出勤"));
  assert.ok(insights.data.timeline.some((item) => item.type === "已确认反馈"));
  const month = today.slice(0, 7), monthly = await request(`/api/finance/monthly?month=${month}`, { cookie });
  assert.equal(monthly.response.status, 200);
  assert.ok(monthly.data.items.some((item) => item.lessonId === lessonId && item.pricingRuleId));
  if (round === 1) {
    const monthlyExport = await request(`/api/finance/export?mode=monthly&month=${month}`, { cookie });
    assert.equal(monthlyExport.response.status, 200);
    assert.match(monthlyExport.response.headers.get("content-type") || "", /spreadsheetml/);
    sql(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000) INSERT INTO questions(stem,question_type,stage,grade,knowledge_points,answer,analysis,status) SELECT ${quote(`${marker}_benchmark_`)}||n,'单选题','高中','高一','人民民主','A','合成检索性能样本','active' FROM seq;`);
    const started = performance.now(), search = await request("/api/questions?stage=高中&grade=高一&knowledge=人民民主&sort=use_count_asc", { cookie }), elapsedMs = performance.now() - started;
    benchmarkMs = Number(elapsedMs.toFixed(1));
    assert.equal(search.response.status, 200);
    assert.ok(search.data.total >= 1000);
    assert.ok(elapsedMs < 1000, `1000题组合检索耗时 ${elapsedMs.toFixed(1)}ms`);
  }
  await request(`/api/workflow-templates?id=${templateId}`, { cookie, method: "DELETE" });
  return { round, lessonId, idempotent: true, undoRestoredDraft: true, protectedArtifacts: true, pricingSnapshot: true, benchmarkMs };
}

try {
  const aiMockBase = await startAiMock();
  await writeFile(devVars, `TEACHER_ADMIN_ACCOUNT=${marker}\nTEACHER_ADMIN_PASSWORD=${e2ePassword}\nTEACHER_ADMIN_SESSION_SECRET=${e2eSessionSecret}\nDEEPSEEK_AI_ENABLED=true\nDEEPSEEK_API_KEY=local-e2e-only\nDEEPSEEK_API_BASE=${aiMockBase}\n`, { mode: 0o600 });
  server = spawn("pnpm", ["dev"], { cwd: root, env: { ...process.env, CLOUDFLARE_ENV: "e2e" }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => logs.push(String(chunk).trim()));
  await waitForServer();
  if (serveOnly) {
    console.log("本地浏览器验收服务器已就绪；按 Ctrl+C 停止。");
    await new Promise((resolve) => process.once("SIGINT", resolve));
  } else {
    const access = await exerciseAnonymousAiBoundary();
    const cookie = await login();
    const demo = await exerciseComprehensiveDemo(cookie);
    const ai = await exerciseAiWorkflows(cookie);
    const rounds = [await exerciseRound(1, cookie), await exerciseRound(2, cookie)];
    cleanup();
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ ok: true, localOnly: true, access, demo, ai, rounds, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`综合演示数据、DeepSeek 本地模拟与今日教学闭环回归通过：AI 隐私/学习/题库审核完整链路 1 轮，教学闭环 ${rounds.length} 轮；报告 ${path.relative(root, reportPath)}`);
  }
} finally {
  try { cleanup(); } catch {}
  if (server && !server.killed) server.kill("SIGINT");
  if (aiMockServer) await new Promise((resolve) => aiMockServer.close(resolve));
  await rm(devVars, { force: true });
}
