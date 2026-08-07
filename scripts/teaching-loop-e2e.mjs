import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
const created = {
  assetIds: [],
  assessmentIds: [],
  examProjectIds: [],
  scheduleImportIds: [],
  scheduleClassIds: [],
  scheduleStudentIds: [],
  scheduleLessonIds: [],
  questionSetIds: [],
  paperIds: [],
  miniAccountIds: [],
};

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const listSql = (ids) => ids.length ? ids.join(",") : "NULL";

function aiEnvelope(model, content) {
  return JSON.stringify({
    id: `local-mock-${Date.now()}`,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(content) } }],
    model,
    usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100, completion_tokens: 60, total_tokens: 180 },
  });
}

function aiMockContent(body, payload) {
  if (payload?.requiredJsonExample?.tiers && Array.isArray(payload?.confirmedActiveWrongQuestions)) {
    const wrongQuestionId = Number(payload.confirmedActiveWrongQuestions[0]?.wrongQuestionId);
    return {
      summary: "根据教师已登记错题，先补基础概念，再突破材料对应，最后进行迁移检测。",
      tiers: [
        { level: "基础巩固", target: "回扣现有错题涉及的基础概念。", evidence: [`错题#${wrongQuestionId}`], actions: ["重做原题并标注概念依据。"], wrongQuestionIds: [wrongQuestionId] },
        { level: "重点突破", target: "纠正教师已记录的具体错因。", evidence: [`错题#${wrongQuestionId}`], actions: ["用观点—材料—结论三步复述。"], wrongQuestionIds: [wrongQuestionId] },
        { level: "迁移提升", target: "用同一知识点完成变式表达。", evidence: [`错题#${wrongQuestionId}`], actions: ["由教师从正式题库选择一题复测。"], wrongQuestionIds: [wrongQuestionId] },
      ],
      correctionSteps: ["独立重做", "对照既有解析标注错因", "教师口头复核"],
      teacherChecks: ["确认正式答案与解析仍适用于当前教学范围"],
      uncertainty: [],
    };
  }
  if (payload?.requiredJsonExample?.options && Array.isArray(payload?.candidates)) {
    return {
      summary: "以下方案均来自系统排除现有课时冲突后的真实候选空档。",
      options: payload.candidates.slice(0, 2).map((candidate, index) => ({ candidateId: candidate.candidateId, priority: index === 0 ? "首选" : "备选", reason: index === 0 ? "与原课时时间最接近，调整成本较低。" : "无课时冲突，可作为后备方案。", tradeoffs: ["仍需确认学生和场地"] })),
      teacherChecks: ["逐一确认学生可参加", "确认场地最终可用"],
      uncertainty: ["系统没有学生个人日历与场地预约确认结果"],
    };
  }
  if (payload?.requiredJsonExample?.risks) return {
    summary: "试卷结构总体可用，但仍需教师核对题型、难度与分值梯度。",
    strengths: ["题型与知识点均有明确标注"],
    risks: [{ level: "中", title: "难度梯度需复核", evidence: "现有题目难度分布存在集中区间", recommendation: "按由易到难顺序人工核对题目排列" }],
    recommendedActions: ["先核对高分题与预计时长", "再核对知识点覆盖"],
    evidenceSummary: ["题型分布", "难度分布", "分值与知识点"],
    uncertainty: ["未读取答案与解析正文，无法判断答案正确性"],
  };
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
  if (payload?.requiredJsonExample?.teachingGoals) return {
    teachingGoals: "基于课时已有课题，形成可核对的知识理解与材料分析目标。",
    keyPoints: "围绕已有知识点梳理材料与观点之间的对应关系。",
    difficultPoints: "区分材料事实、教材观点与结论，避免跳步。",
    materials: "使用课时已有教材目录、教师讲义和已关联正式题目。",
    lessonFlow: "回顾上一节记录—呈现已有材料—分层设问—正式题目检测—教师总结。",
    questionUsePlan: "先独立作答已关联题目，再根据错因进行针对性讲评。",
    evidenceSummary: ["课时已有课题", "上一节真实记录", "已关联正式题目"],
    uncertainty: [],
  };
  if (payload?.requiredJsonExample?.expectedVsActual) return {
    problemType: "材料分析",
    tags: "材料分析,规范表达",
    expectedVsActual: "根据既有教学目标与实际内容，课堂完成主体内容，材料分析步骤仍需复盘。",
    effectivePractices: "教师记录显示使用了材料关键词提取与分层表达。",
    difficulties: "学生在材料信息与教材观点对应时仍有跳步。",
    studentEvidence: "仅根据匿名课堂评分、出勤和教师备注整理。",
    nextAction: "下节课先用一道已核对材料题复测，再针对错因讲评。",
    reusableMaterial: "保留关键词—观点—材料—结论的四步提示语。",
    evidenceSummary: ["实际教学内容", "匿名课堂记录", "作业完成汇总"],
    uncertainty: [],
  };
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

function databaseHasTeachingTables(file) {
  const candidate = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = candidate
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('lessons','lesson_finance')")
      .all();
    return tables.length === 2;
  } finally {
    candidate.close();
  }
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      if (databaseHasTeachingTables(full)) return full;
    }
  }
  return null;
}

const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
assert.ok(database?.includes(`${path.sep}.wrangler${path.sep}state${path.sep}`), "只允许使用项目本地 D1");
const sqlite = new DatabaseSync(database);
sqlite.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");

function sql(statement) {
  sqlite.exec(statement);
}

function rows(statement) {
  return sqlite.prepare(statement).all().map((row) => ({ ...row }));
}

function cleanupBusinessCoverage() {
  const assetIds = listSql(created.assetIds);
  const assessmentIds = listSql(created.assessmentIds);
  const examProjectIds = listSql(created.examProjectIds);
  const scheduleImportIds = listSql(created.scheduleImportIds);
  const scheduleClassIds = listSql(created.scheduleClassIds);
  const scheduleStudentIds = listSql(created.scheduleStudentIds);
  const scheduleLessonIds = listSql(created.scheduleLessonIds);
  const questionSetIds = listSql(created.questionSetIds);
  const paperIds = listSql(created.paperIds);
  const miniAccountIds = listSql(created.miniAccountIds);
  const markerStudents = `SELECT id FROM students WHERE name LIKE ${quote(`${marker}%`)}`;
  const scheduleStudents = `SELECT id FROM students WHERE name=${quote("__e2e__课表学生")}`;
  const scheduleLessons = `SELECT id FROM lessons WHERE id IN (${scheduleLessonIds}) OR (date IN ('2030-01-12','2030-01-13') AND location=${quote("__e2e__教室")})`;
  sql(`PRAGMA foreign_keys=ON;
    DELETE FROM recognition_items WHERE job_id IN (SELECT id FROM recognition_jobs WHERE source_asset_id IN (${assetIds}) OR assessment_id IN (${assessmentIds}));
    DELETE FROM recognition_jobs WHERE source_asset_id IN (${assetIds}) OR assessment_id IN (${assessmentIds});
    DELETE FROM assessment_question_results WHERE assessment_result_id IN (SELECT id FROM assessment_results WHERE assessment_id IN (${assessmentIds}) OR assessment_id IN (SELECT id FROM assessments WHERE exam_project_id IN (${examProjectIds})) OR student_id IN (${markerStudents}));
    DELETE FROM knowledge_evidence WHERE student_id IN (${markerStudents});
    DELETE FROM exam_project_students WHERE project_id IN (${examProjectIds}) OR student_id IN (${markerStudents});
    DELETE FROM assessment_results WHERE assessment_id IN (${assessmentIds}) OR assessment_id IN (SELECT id FROM assessments WHERE exam_project_id IN (${examProjectIds})) OR student_id IN (${markerStudents});
    DELETE FROM assessments WHERE id IN (${assessmentIds}) OR exam_project_id IN (${examProjectIds});
    DELETE FROM exam_projects WHERE id IN (${examProjectIds});
    DELETE FROM academic_years WHERE name='2026-2027' AND NOT EXISTS (SELECT 1 FROM exam_projects WHERE academic_year='2026-2027');
    DELETE FROM resources WHERE title LIKE ${quote(`${marker}%`)} OR source_ref LIKE ${quote(`reflection:${marker}%`)};
    DELETE FROM reflections WHERE tags LIKE ${quote(`${marker}%`)} OR expected_vs_actual LIKE ${quote(`${marker}%`)};
    DELETE FROM saved_question_views WHERE name LIKE ${quote(`${marker}%`)};
    DELETE FROM schedule_import_rows WHERE lesson_id IN (${scheduleLessons}) OR import_id IN (${scheduleImportIds}) OR import_id IN (SELECT id FROM schedule_imports WHERE source_name='browser-synthetic.csv');
    DELETE FROM schedule_imports WHERE id IN (${scheduleImportIds}) OR source_name='browser-synthetic.csv';
    DELETE FROM feedback_evidence WHERE feedback_id IN (SELECT id FROM feedback WHERE lesson_id IN (${scheduleLessons}) OR student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents}) OR class_id IN (${scheduleClassIds}));
    DELETE FROM ai_feedback_drafts WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM lesson_completion_runs WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM lesson_workflow_state WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM lesson_questions WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM wrong_questions WHERE lesson_id IN (${scheduleLessons}) OR student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents});
    DELETE FROM student_lesson_records WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM feedback_imports WHERE matched_lesson_id IN (${scheduleLessons}) OR confirmed_lesson_id IN (${scheduleLessons});
    DELETE FROM feedback WHERE lesson_id IN (${scheduleLessons}) OR student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents}) OR class_id IN (${scheduleClassIds});
    DELETE FROM reflections WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM assignment_assets WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id IN (${scheduleLessons}) OR class_id IN (${scheduleClassIds}));
    DELETE FROM assignment_targets WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id IN (${scheduleLessons}) OR class_id IN (${scheduleClassIds}));
    DELETE FROM assignment_settings WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id IN (${scheduleLessons}) OR class_id IN (${scheduleClassIds}));
    DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id IN (${scheduleLessons}) OR class_id IN (${scheduleClassIds}));
    DELETE FROM assignments WHERE lesson_id IN (${scheduleLessons}) OR class_id IN (${scheduleClassIds});
    DELETE FROM package_ledger WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM settlement_items WHERE lesson_finance_id IN (SELECT id FROM lesson_finance WHERE lesson_id IN (${scheduleLessons}));
    DELETE FROM lesson_billing_items WHERE lesson_finance_id IN (SELECT id FROM lesson_finance WHERE lesson_id IN (${scheduleLessons}));
    DELETE FROM lesson_finance WHERE lesson_id IN (${scheduleLessons});
    DELETE FROM attendance WHERE lesson_id IN (${scheduleLessons}) OR student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents});
    DELETE FROM pricing_rules WHERE student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents});
    DELETE FROM sync_events WHERE student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents});
    DELETE FROM lessons WHERE id IN (${scheduleLessons});
    DELETE FROM enrollments WHERE class_id IN (${scheduleClassIds}) OR student_id IN (${scheduleStudentIds}) OR student_id IN (${scheduleStudents});
    DELETE FROM students WHERE id IN (${scheduleStudentIds}) OR id IN (${scheduleStudents});
    DELETE FROM classes WHERE id IN (${scheduleClassIds});
    DELETE FROM enrollments WHERE class_id IN (SELECT id FROM classes WHERE name=${quote("__e2e__课表学生课程")}) OR student_id IN (${scheduleStudents});
    DELETE FROM students WHERE id IN (${scheduleStudents});
    DELETE FROM classes WHERE name=${quote("__e2e__课表学生课程")};
    DELETE FROM questions WHERE question_set_id IN (${questionSetIds});
    DELETE FROM question_sets WHERE id IN (${questionSetIds});
    DELETE FROM lesson_workflow_state WHERE homework_paper_id IN (${paperIds}) OR homework_paper_id IN (SELECT id FROM papers WHERE title LIKE ${quote(`%${marker}%`)});
    DELETE FROM export_jobs WHERE paper_id IN (${paperIds}) OR paper_id IN (SELECT id FROM papers WHERE title LIKE ${quote(`%${marker}%`)});
    DELETE FROM paper_questions WHERE paper_id IN (${paperIds}) OR paper_id IN (SELECT id FROM papers WHERE title LIKE ${quote(`%${marker}%`)});
    DELETE FROM paper_files WHERE paper_id IN (${paperIds}) OR paper_id IN (SELECT id FROM papers WHERE title LIKE ${quote(`%${marker}%`)});
    DELETE FROM papers WHERE id IN (${paperIds}) OR title LIKE ${quote(`%${marker}%`)};
    DELETE FROM file_leases WHERE asset_id IN (${assetIds});
    DELETE FROM file_assets WHERE id IN (${assetIds});
    DELETE FROM mini_sessions WHERE account_id IN (${miniAccountIds}) OR account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE ${quote(`test:${marker}_%`)});
    DELETE FROM mini_bindings WHERE account_id IN (${miniAccountIds}) OR account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE ${quote(`test:${marker}_%`)});
    DELETE FROM parent_student_links WHERE parent_account_id IN (${miniAccountIds}) OR parent_account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE ${quote(`test:${marker}_%`)});
    DELETE FROM sync_events WHERE account_id IN (${miniAccountIds}) OR account_id IN (SELECT id FROM wechat_accounts WHERE open_id LIKE ${quote(`test:${marker}_%`)});
    DELETE FROM wechat_accounts WHERE id IN (${miniAccountIds}) OR open_id LIKE ${quote(`test:${marker}_%`)};`);
}

function cleanup() {
  cleanupBusinessCoverage();
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

async function request(pathname, { cookie, token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 300) }; }
  return { response, data };
}

async function multipartRequest(pathname, { cookie, method = "POST", form } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}) },
    body: form,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 300) }; }
  return { response, data };
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`本地服务提前退出（code ${server.exitCode}）：${logs.slice(-8).join("\n")}`);
    }
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
    request("/api/ai/lesson-prep", { method: "POST", body: { lessonId: 1 } }),
    request("/api/ai/paper-review", { method: "POST", body: { paperId: 1 } }),
    request("/api/ai/reflection-drafts", { method: "POST", body: { lessonId: 1 } }),
    request("/api/ai/wrong-question-remediation", { method: "POST", body: { studentId: 1 } }),
    request("/api/ai/schedule-reschedule", { method: "POST", body: { lessonId: 1 } }),
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
    const remediationStudent = rows("SELECT s.id,s.name FROM students s JOIN demo_records d ON d.entity_type='student' AND d.entity_id=s.id JOIN wrong_questions w ON w.student_id=s.id AND w.status='active' GROUP BY s.id ORDER BY s.id LIMIT 1")[0];
    const rescheduleLesson = rows("SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime FROM lessons l JOIN demo_records d ON d.entity_type='lesson' AND d.entity_id=l.id WHERE l.status NOT IN ('completed','cancelled') AND TRIM(COALESCE(l.start_time,''))<>'' AND TRIM(COALESCE(l.end_time,''))<>'' AND l.date>=date('now','+8 hours') ORDER BY l.date,l.start_time LIMIT 1")[0];
    assert.ok(remediationStudent?.id); assert.ok(rescheduleLesson?.id);
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
    const paper = rows("SELECT p.id FROM papers p JOIN demo_records d ON d.entity_type='paper' AND d.entity_id=p.id JOIN paper_questions pq ON pq.paper_id=p.id GROUP BY p.id ORDER BY p.id LIMIT 1")[0];
    assert.ok(paper?.id);
    const immutableBefore = rows(`SELECT (SELECT teaching_goals FROM lessons WHERE id=${Number(lesson.id)}) AS teachingGoals,(SELECT updated_at FROM papers WHERE id=${Number(paper.id)}) AS paperUpdatedAt,(SELECT COUNT(*) FROM reflections) AS reflections,(SELECT GROUP_CONCAT(status) FROM wrong_questions WHERE student_id=${Number(remediationStudent.id)} ORDER BY id) AS wrongStatuses,(SELECT date||'|'||start_time||'|'||end_time FROM lessons WHERE id=${Number(rescheduleLesson.id)}) AS rescheduleSlot`)[0];
    const lessonPrep = await request("/api/ai/lesson-prep", { cookie, method: "POST", body: { lessonId: Number(lesson.id) } });
    assert.equal(lessonPrep.response.status, 200, JSON.stringify(lessonPrep.data));
    assert.ok(lessonPrep.data.draft.teachingGoals);
    assert.ok(lessonPrep.data.excludedFields.includes("学生姓名和联系方式"));
    const lessonPrepRequest = aiMock.requests.at(-1);
    assert.doesNotMatch(JSON.stringify(lessonPrepRequest.payload), new RegExp(String(student.name)));
    const paperReview = await request("/api/ai/paper-review", { cookie, method: "POST", body: { paperId: Number(paper.id) } });
    assert.equal(paperReview.response.status, 200, JSON.stringify(paperReview.data));
    assert.ok(paperReview.data.review.risks.length);
    const paperReviewRequest = aiMock.requests.at(-1);
    assert.ok(Array.isArray(paperReviewRequest.payload.questions));
    assert.ok(paperReviewRequest.payload.questions.every((item) => !("answer" in item) && !("analysis" in item)));
    const reflectionDraft = await request("/api/ai/reflection-drafts", { cookie, method: "POST", body: { lessonId: Number(lesson.id) } });
    assert.equal(reflectionDraft.response.status, 200, JSON.stringify(reflectionDraft.data));
    assert.ok(reflectionDraft.data.draft.nextAction);
    assert.ok(reflectionDraft.data.excludedFields.includes("学生姓名和联系方式"));
    const remediationDraft = await request("/api/ai/wrong-question-remediation", { cookie, method: "POST", body: { studentId: Number(remediationStudent.id) } });
    assert.equal(remediationDraft.response.status, 200, JSON.stringify(remediationDraft.data));
    assert.equal(remediationDraft.data.draft.tiers.length, 3);
    assert.ok(remediationDraft.data.excludedFields.includes("学生姓名和联系方式"));
    const remediationRequest = aiMock.requests.at(-1);
    assert.doesNotMatch(JSON.stringify(remediationRequest.payload), new RegExp(String(remediationStudent.name)));
    const rescheduleDraft = await request("/api/ai/schedule-reschedule", { cookie, method: "POST", body: { lessonId: Number(rescheduleLesson.id) } });
    assert.equal(rescheduleDraft.response.status, 200, JSON.stringify(rescheduleDraft.data));
    assert.ok(rescheduleDraft.data.draft.options.length > 0);
    const rescheduleRequest = aiMock.requests.at(-1), allowedCandidateIds = new Set(rescheduleRequest.payload.candidates.map((item) => item.candidateId));
    assert.ok(rescheduleDraft.data.draft.options.every((item) => allowedCandidateIds.has(item.candidateId)));
    const immutableAfter = rows(`SELECT (SELECT teaching_goals FROM lessons WHERE id=${Number(lesson.id)}) AS teachingGoals,(SELECT updated_at FROM papers WHERE id=${Number(paper.id)}) AS paperUpdatedAt,(SELECT COUNT(*) FROM reflections) AS reflections,(SELECT GROUP_CONCAT(status) FROM wrong_questions WHERE student_id=${Number(remediationStudent.id)} ORDER BY id) AS wrongStatuses,(SELECT date||'|'||start_time||'|'||end_time FROM lessons WHERE id=${Number(rescheduleLesson.id)}) AS rescheduleSlot`)[0];
    assert.deepEqual(immutableAfter, immutableBefore);
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
    const batchRequests = aiMock.requests.filter((item) => Array.isArray(item.payload?.questions) && Array.isArray(item.payload?.safeFields) && item.body.model === "deepseek-v4-flash");
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

    return { mockedProviderCalls: aiMock.requests.length, feedbackDraft: true, lessonPrep: true, paperReview: true, reflectionDraft: true, wrongQuestionRemediation: true, scheduleReschedule: true, privacyPreflight: true, learningLifecycle: true, failureIsolation: true, questionBatch: { total: 12, batches: 2, resumable: true }, proSingleReview: true, staleProtection: true, usageRecorded: true };
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

  const financeOperationId = `${marker}_finance_${round}`;
  const adjustmentWithoutReason = await request("/api/finance", { cookie, method: "POST", body: { action: "preview", operationId: financeOperationId, lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 10 } });
  assert.equal(adjustmentWithoutReason.response.status, 422);
  const financePreview = await request("/api/finance", { cookie, method: "POST", body: { action: "preview", operationId: financeOperationId, lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 0 } });
  assert.equal(financePreview.response.status, 200, JSON.stringify(financePreview.data));
  assert.equal(financePreview.data.context.canConfirm, true);
  assert.equal(financePreview.data.preview.expectedAmount, 80);
  const financeConfirm = await request("/api/finance", { cookie, method: "POST", body: { action: "confirm", operationId: financeOperationId, previewToken: financePreview.data.previewToken, lessonId, payerType: "parent", payerId: studentIds[0], adjustment: 0 } });
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
  return { round, lessonId, studentIds, questionIds, topic, dueAt, today, idempotent: true, undoRestoredDraft: true, protectedArtifacts: true, pricingSnapshot: true, benchmarkMs };
}

async function exerciseRecognitionBusiness(cookie) {
  const checks = [];
  const classId = Number(rows(`SELECT class_id AS classId FROM lessons WHERE id=${rounds[1].lessonId}`)[0].classId);
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const uploadForm = new FormData();
  uploadForm.set("file", new File([png], `${marker}_answer.png`, { type: "image/png" }), `${marker}_answer.png`);
  uploadForm.set("ownerType", "recognition");
  uploadForm.set("purpose", "recognition");
  const uploaded = await multipartRequest("/api/files", { cookie, form: uploadForm });
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
  const sourceAssetId = Number(uploaded.data.id);
  created.assetIds.push(sourceAssetId);
  checks.push("答题卡图片上传");

  const assessment = await request("/api/assessments", { cookie, method: "POST", body: { classId, title: `${marker}_测验`, date: rounds[1].today, totalScore: 100 } });
  assert.equal(assessment.response.status, 201, JSON.stringify(assessment.data));
  const assessmentId = Number(assessment.data.assessment.id);
  created.assessmentIds.push(assessmentId);
  checks.push("测验建档");

  const items = [{
    questionNumber: "1",
    studentAnswer: "人民当家作主",
    standardAnswer: "人民当家作主",
    recognizedScore: 1,
    teacherScore: 1,
    maxScore: 2,
    confidence: 0.99,
    candidates: [],
    knowledgePoints: "人民民主",
    errorType: null,
    reviewStatus: "confirmed",
  }];
  const job = await request("/api/recognition", { cookie, method: "POST", body: { action: "create", assessmentId, studentId: rounds[1].studentIds[0], sourceAssetId, items } });
  assert.equal(job.response.status, 201, JSON.stringify(job.data));
  const jobId = Number(job.data.id);
  checks.push("识别任务创建");

  const list = await request(`/api/recognition?id=${jobId}`, { cookie });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.items.length >= 1);
  const saved = await request("/api/recognition", { cookie, method: "POST", body: { action: "save", jobId, items: list.data.items, progress: 100 } });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  const confirmed = await request("/api/recognition", { cookie, method: "POST", body: { action: "confirm", jobId } });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.count, 1);
  const repeated = await request("/api/recognition", { cookie, method: "POST", body: { action: "confirm", jobId } });
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.data));
  assert.equal(repeated.data.alreadyConfirmed, true);
  checks.push("逐题校对确认", "幂等复确认");
  return { checks, ok: true };
}

async function exerciseResourcesBusiness(cookie) {
  const createdResource = await request("/api/resources", { cookie, method: "POST", body: { title: `${marker}_资源`, type: "教学策略", content: `${marker}_内容` } });
  assert.equal(createdResource.response.status, 201, JSON.stringify(createdResource.data));
  const resourceId = Number(createdResource.data.resource.id);
  const list = await request("/api/resources", { cookie });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.canWrite, true);
  assert.ok(list.data.resources.some((resource) => resource.id === resourceId));
  const removed = await request(`/api/resources/${resourceId}`, { cookie, method: "DELETE" });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.data));
  return { checks: ["资源新增", "教师可写列表", "资源删除"], ok: true };
}

async function exerciseReflectionsBusiness(cookie) {
  const checks = [];
  const reflection = await request("/api/reflections", { cookie, method: "POST", body: { date: rounds[1].today, lessonId: rounds[1].lessonId, tags: `${marker}_反思`, expectedVsActual: `${marker}_预期与结果`, nextAction: "下次课继续巩固" } });
  assert.equal(reflection.response.status, 201, JSON.stringify(reflection.data));
  const reflectionId = Number(reflection.data.reflection.id);
  checks.push("普通反思新增");
  const strategyDenied = await request("/api/reflections", { cookie, method: "POST", body: { date: rounds[1].today, isStrategy: true, tags: `${marker}_策略直传` } });
  assert.equal(strategyDenied.response.status, 409, JSON.stringify(strategyDenied.data));
  checks.push("策略反思入口校验");
  const resource = await request("/api/resources", { cookie, method: "POST", body: { title: `${marker}_策略沉淀`, type: "教学策略", content: "沉淀为可复用策略", sourceRef: `reflection:${reflectionId}` } });
  assert.equal(resource.response.status, 201, JSON.stringify(resource.data));
  const promoted = await request(`/api/reflections/${reflectionId}`, { cookie, method: "PUT", body: { date: rounds[1].today, lessonId: rounds[1].lessonId, tags: `${marker}_反思`, expectedVsActual: `${marker}_预期与结果`, nextAction: "下次课继续巩固", isStrategy: true } });
  assert.equal(promoted.response.status, 200, JSON.stringify(promoted.data));
  assert.equal(promoted.data.reflection.isStrategy, true);
  const list = await request("/api/reflections", { cookie });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.reflections.some((item) => item.id === reflectionId && item.isStrategy === true));
  checks.push("资源沉淀", "反思转策略", "策略列表可见");
  return { checks, ok: true };
}

async function exerciseQuestionViewsBusiness(cookie) {
  const name = `${marker}_筛选方案`;
  const first = await request("/api/question-views", { cookie, method: "POST", body: { name, filters: { grade: "高一", knowledge: "人民民主" } } });
  assert.equal(first.response.status, 201, JSON.stringify(first.data));
  const viewId = Number(first.data.view.id);
  const second = await request("/api/question-views", { cookie, method: "POST", body: { name, filters: { grade: "高一", knowledge: "人民民主" } } });
  assert.equal(second.response.status, 200, JSON.stringify(second.data));
  assert.equal(Number(second.data.view.id), viewId);
  const list = await request("/api/question-views", { cookie });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.views.some((view) => view.id === viewId));
  const removed = await request(`/api/question-views/${viewId}`, { cookie, method: "DELETE" });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.data));
  return { checks: ["筛选方案新建", "同名更新", "方案删除"], ok: true };
}

async function exerciseScheduleImportsBusiness(cookie) {
  const checks = [];
  const csv = String(await readFile(path.join(root, "tests", "fixtures", "schedule-import", "browser-synthetic.csv"), "utf8")).replace(/^\uFEFF/, "");
  const form = new FormData();
  form.set("file", new File([csv], "browser-synthetic.csv", { type: "text/csv" }), "browser-synthetic.csv");
  const imported = await multipartRequest("/api/schedule-imports", { cookie, form });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
  const importId = Number(imported.data.id);
  created.scheduleImportIds.push(importId);
  assert.equal(imported.data.report.total, 1);
  checks.push("课表 CSV 导入");
  const history = await request("/api/schedule-imports", { cookie });
  assert.equal(history.response.status, 200, JSON.stringify(history.data));
  assert.ok(
    Array.isArray(history.data.imports) &&
      history.data.imports.some((item) => Number(item.id) === importId),
    JSON.stringify(history.data),
  );
  checks.push("课表导入历史列表");
  const confirmed = await request(`/api/schedule-imports/${importId}/confirm`, { cookie, method: "POST" });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.report.created, 1);
  assert.equal(confirmed.data.report.studentsCreated, 1);
  assert.ok(Array.isArray(confirmed.data.rows), JSON.stringify(confirmed.data));
  const confirmedRow = confirmed.data.rows.find((row) => row.action === "created");
  assert.ok(confirmedRow?.lessonId, JSON.stringify(confirmed.data));
  checks.push("课表确认落库");
  const detail = await request(`/api/schedule-imports/${importId}`, { cookie });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.data));
  assert.equal(Number(detail.data.import.id), importId);
  assert.ok(detail.data.import.report?.created === 1, JSON.stringify(detail.data));
  assert.ok(
    detail.data.rows.some((row) => row.action === "created" && row.lessonId),
    JSON.stringify(detail.data),
  );
  checks.push("课表历史报告逐行可查");
  const lessonRow = rows(`SELECT lesson_id AS lessonId FROM schedule_import_rows WHERE import_id=${importId} AND action='created' LIMIT 1`)[0];
  assert.ok(lessonRow?.lessonId);
  const lessonId = Number(lessonRow.lessonId);
  created.scheduleLessonIds.push(lessonId);
  const classRow = rows(`SELECT id FROM classes WHERE name=${quote("__e2e__课表学生课程")} LIMIT 1`)[0];
  const studentRow = rows(`SELECT id FROM students WHERE name=${quote("__e2e__课表学生")} LIMIT 1`)[0];
  assert.ok(classRow?.id && studentRow?.id);
  created.scheduleClassIds.push(Number(classRow.id));
  created.scheduleStudentIds.push(Number(studentRow.id));
  checks.push("课表学生与课时关联");

  const retryCsv = "日期,上课时间,结束时间,学生姓名,课程名称,地点,底薪,每生提成\n2030-01-13,09:00,10:30,__e2e__课表学生,政治,__e2e__教室,100,20\n2030-01-13,09:30,11:00,__e2e__课表学生,政治,__e2e__教室,100,20\n";
  const retryForm = new FormData();
  retryForm.set("file", new File([retryCsv], "browser-synthetic-retry.csv", { type: "text/csv" }), "browser-synthetic-retry.csv");
  const retryImport = await multipartRequest("/api/schedule-imports", { cookie, form: retryForm });
  assert.equal(retryImport.response.status, 201, JSON.stringify(retryImport.data));
  const retryImportId = Number(retryImport.data.id);
  created.scheduleImportIds.push(retryImportId);
  assert.equal(retryImport.data.report.total, 2);
  assert.equal(retryImport.data.report.create, 2);

  const partial = await request(`/api/schedule-imports/${retryImportId}/confirm`, { cookie, method: "POST" });
  assert.equal(partial.response.status, 200, JSON.stringify(partial.data));
  assert.equal(partial.data.status, "partial", JSON.stringify(partial.data));
  assert.equal(partial.data.report.created, 1);
  assert.equal(partial.data.report.blocked, 1);
  assert.equal(partial.data.report.remaining, 1);
  checks.push("课表部分完成状态");

  const partialRows = rows(`SELECT id,lesson_id AS lessonId,action FROM schedule_import_rows WHERE import_id=${retryImportId} ORDER BY row_number`);
  const createdRetryRow = partialRows.find((item) => item.action === "created");
  const blockedRetryRow = partialRows.find((item) => item.action === "blocked");
  assert.ok(createdRetryRow?.lessonId && blockedRetryRow?.lessonId, JSON.stringify(partialRows));
  created.scheduleLessonIds.push(Number(createdRetryRow.lessonId));
  sql(`UPDATE lessons SET status='cancelled' WHERE id=${Number(createdRetryRow.lessonId)}`);

  const retried = await request(`/api/schedule-imports/${retryImportId}/confirm`, { cookie, method: "POST" });
  assert.equal(retried.response.status, 200, JSON.stringify(retried.data));
  assert.equal(retried.data.status, "confirmed", JSON.stringify(retried.data));
  assert.equal(retried.data.report.created, 1);
  assert.equal(retried.data.report.blocked, 0);
  assert.equal(retried.data.report.remaining, 0);
  const retriedRows = rows(`SELECT id,lesson_id AS lessonId,action FROM schedule_import_rows WHERE import_id=${retryImportId} ORDER BY row_number`);
  const retriedCreated = retriedRows.find((item) => item.action === "created" && Number(item.id) !== Number(createdRetryRow.id));
  assert.ok(retriedCreated?.lessonId, JSON.stringify(retriedRows));
  created.scheduleLessonIds.push(Number(retriedCreated.lessonId));
  checks.push("课表失败任务重试只补剩余行");
  return { checks, ok: true };
}

async function exerciseExamProjectsBusiness(cookie) {
  const checks = [];
  const createdProject = await request("/api/exam-projects", { cookie, method: "POST", body: { academicYear: "2026-2027" } });
  assert.equal(createdProject.response.status, 201, JSON.stringify(createdProject.data));
  const projects = await request("/api/exam-projects", { cookie });
  assert.equal(projects.response.status, 200, JSON.stringify(projects.data));
  const yearProjects = projects.data.projects.filter((project) => String(project.academic_year || project.academicYear || "") === "2026-2027");
  assert.ok(yearProjects.length > 0);
  for (const project of yearProjects) created.examProjectIds.push(Number(project.id));
  checks.push("考试项目学年生成");
  const project = yearProjects.find((item) => item.grade === "高一");
  assert.ok(project?.id, JSON.stringify(yearProjects));
  const studentsView = await request(`/api/exam-projects/${project.id}/results`, { cookie });
  assert.equal(studentsView.response.status, 200, JSON.stringify(studentsView.data));
  assert.ok(studentsView.data.students.length >= 2);
  const results = studentsView.data.students.slice(0, 2).map((student, index) => ({ studentId: Number(student.studentId), score: index === 0 ? 82 : 91, questions: [{ questionNumber: "1", questionId: rounds[1].questionIds[0], answer: index === 0 ? "A" : "B", score: index === 0 ? 1 : 2, maxScore: 2, knowledgePoints: "人民民主" }] }));
  const recorded = await request(`/api/exam-projects/${project.id}/results`, { cookie, method: "PUT", body: { results } });
  assert.equal(recorded.response.status, 200, JSON.stringify(recorded.data));
  assert.equal(recorded.data.updated, 2);
  checks.push("考试成绩录入");
  const analytics = await request(`/api/exam-projects/${project.id}/analytics`, { cookie });
  assert.equal(analytics.response.status, 200, JSON.stringify(analytics.data));
  assert.equal(analytics.data.dataStatus, "ready");
  assert.ok(analytics.data.summary.recorded >= 2);
  checks.push("成绩分析就绪");
  return { checks, ok: true };
}

async function exerciseQuestionSetsBusiness(cookie) {
  const checks = [];
  const sourceForm = new FormData();
  sourceForm.set("file", new File([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], "e2e-questions.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "e2e-questions.docx");
  const source = await multipartRequest("/api/question-sets/source", { cookie, form: sourceForm });
  assert.equal(source.response.status, 200, JSON.stringify(source.data));
  const sourceDownload = await fetch(`${baseUrl}/api/question-sets/source?key=${encodeURIComponent(source.data.key)}`, { headers: { cookie } });
  assert.equal(sourceDownload.status, 200, `source download: ${sourceDownload.status}`);
  assert.deepEqual([...new Uint8Array(await sourceDownload.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  checks.push("原始文件断点下载");
  const missingSource = await request(`/api/question-sets/source?key=${encodeURIComponent("question-sources/2026-08-07/__e2e__missing.docx")}`, { cookie });
  assert.equal(missingSource.response.status, 404, JSON.stringify(missingSource.data));
  assert.match(String(missingSource.data.error || ""), /重新上传/);
  checks.push("原始文件缺失提示重新上传");
  const questions = [{
    stem: `${marker}_人民民主的本质是什么`,
    options: ["人民当家作主", "依法治国", "以德治国", "自由平等"],
    answer: "A",
    analysis: `${marker}_解析：人民当家作主是社会主义民主政治的本质。`,
    knowledgePoints: "人民民主",
    questionType: "单选题",
    stage: "高中",
    grade: "高一",
    year: 2026,
    difficulty: 3,
    reviewed: true,
    status: "review",
  }];
  const imported = await request("/api/question-sets/import", { cookie, method: "POST", body: { name: `${marker}_题组`, sourceFile: "e2e-questions.docx", sourceDocument: source.data.key, sourceKey: source.data.key, sourceFingerprint: source.data.fingerprint, reviewed: true, questions } });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
  const questionSetId = Number(imported.data.questionSet.id);
  created.questionSetIds.push(questionSetId);
  created.paperIds.push(Number(imported.data.questionSet.paperId));
  checks.push("Word 题库导入");
  assert.ok(imported.data.report.typeCounts?.["单选题"] >= 1);
  checks.push("导入报告题型分布");
  const resumedByFile = await request(`/api/question-sets/import?sourceFingerprint=${encodeURIComponent(source.data.fingerprint)}`, { cookie });
  assert.equal(resumedByFile.response.status, 200, JSON.stringify(resumedByFile.data));
  assert.equal(Number(resumedByFile.data.existing?.id), questionSetId);
  checks.push("按文件指纹恢复导入任务");
  const sameFileAgain = await request("/api/question-sets/import", { cookie, method: "POST", body: { name: `${marker}_题组重传`, sourceFile: "e2e-questions.docx", sourceDocument: source.data.key, sourceKey: source.data.key, sourceFingerprint: source.data.fingerprint, reviewed: true, questions } });
  assert.equal(sameFileAgain.response.status, 409, JSON.stringify(sameFileAgain.data));
  assert.equal(Number(sameFileAgain.data.existing?.id), questionSetId);
  checks.push("同文件重复导入按原任务拦截");
  const otherSourceForm = new FormData();
  otherSourceForm.set("file", new File([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1])], "e2e-questions-copy.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "e2e-questions-copy.docx");
  const otherSource = await multipartRequest("/api/question-sets/source", { cookie, form: otherSourceForm });
  assert.equal(otherSource.response.status, 200, JSON.stringify(otherSource.data));
  const copyImport = await request("/api/question-sets/import", { cookie, method: "POST", body: { name: `${marker}_同题不同文件`, sourceFile: "e2e-questions-copy.docx", sourceDocument: otherSource.data.key, sourceKey: otherSource.data.key, sourceFingerprint: otherSource.data.fingerprint, reviewed: true, questions } });
  assert.equal(copyImport.response.status, 409, JSON.stringify(copyImport.data));
  assert.ok(Number(copyImport.data.duplicates) >= 1);
  assert.ok(!copyImport.data.existing?.id);
  checks.push("不同文件相同题按内容提示重复");
  const incompleteSourceForm = new FormData();
  incompleteSourceForm.set("file", new File([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9])], "e2e-incomplete.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "e2e-incomplete.docx");
  const incompleteSource = await multipartRequest("/api/question-sets/source", { cookie, form: incompleteSourceForm });
  assert.equal(incompleteSource.response.status, 200, JSON.stringify(incompleteSource.data));
  const incompleteImport = await request("/api/question-sets/import", { cookie, method: "POST", body: { name: `${marker}_待补充报告`, sourceFile: "e2e-incomplete.docx", sourceDocument: incompleteSource.data.key, sourceKey: incompleteSource.data.key, sourceFingerprint: incompleteSource.data.fingerprint, reviewed: true, questions: [{ stem: `${marker}_完整补充题`, answer: "A", analysis: `${marker}_完整解析`, knowledgePoints: "人民民主", questionType: "单选题", stage: "高中", grade: "高一", reviewed: true, status: "review" }, { stem: `${marker}_缺字段题`, sourceQuestionNumber: 7, questionType: "材料题", stage: "高中", grade: "高一", parseConfidence: 0.4, reviewed: false, status: "review" }] } });
  assert.equal(incompleteImport.response.status, 201, JSON.stringify(incompleteImport.data));
  assert.ok(incompleteImport.data.report.typeCounts?.["单选题"] >= 1);
  assert.ok(incompleteImport.data.report.typeCounts?.["材料题"] >= 1);
  assert.ok(incompleteImport.data.report.incomplete >= 1);
  assert.ok(incompleteImport.data.report.lowConfidence >= 1);
  const incompleteItem = (incompleteImport.data.report.incompleteItems || []).find((item) => Number(item.number) === 7);
  assert.ok(incompleteItem, JSON.stringify(incompleteImport.data.report));
  assert.ok((incompleteItem.missing || []).includes("缺少答案"));
  const lowConfidenceItem = (incompleteImport.data.report.lowConfidenceItems || []).find((item) => Number(item.number) === 7);
  assert.ok(lowConfidenceItem, JSON.stringify(incompleteImport.data.report));
  assert.ok(Number(lowConfidenceItem.confidence) < 0.7);
  checks.push("导入报告待补充与低置信度清单");
  created.questionSetIds.push(Number(incompleteImport.data.questionSet.id));
  created.paperIds.push(Number(incompleteImport.data.questionSet.paperId));
  const overflowQuestions = Array.from({ length: 301 }, (_, index) => ({
    stem: `${marker}_超量边界${String(index + 1).padStart(3, "0")}`,
    answer: index % 2 ? "A" : "B",
    analysis: `${marker}_超量边界解析`,
    knowledgePoints: "超量边界",
    questionType: "单选题",
    stage: "高中",
    grade: "高一",
    reviewed: true,
    status: "review",
  }));
  const rejected = await request("/api/question-sets/import", { cookie, method: "POST", body: { name: `${marker}_超量文件`, sourceFile: "e2e-overflow.docx", questions: overflowQuestions } });
  assert.equal(rejected.response.status, 422, JSON.stringify(rejected.data));
  assert.match(String(rejected.data.error || ""), /300/);
  assert.match(String(rejected.data.error || ""), /301/);
  checks.push("题库导入超量明确拒绝");
  const detail = await request(`/api/question-sets/${questionSetId}`, { cookie });
  assert.equal(detail.response.status, 200, JSON.stringify(detail.data));
  assert.ok(detail.data.questions.length >= 1);
  const confirmed = await request(`/api/question-sets/${questionSetId}/confirm`, { cookie, method: "POST" });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
  assert.ok(confirmed.data.promoted >= 1);
  checks.push("题组确认入库");
  const sourceView = await request(`/api/question-sets/${questionSetId}/source`, { cookie });
  assert.equal(sourceView.response.status, 200, JSON.stringify(sourceView.data));
  checks.push("原始 Word 溯源");
  return { checks, ok: true };
}

async function exerciseFinanceContext(cookie) {
  const context = await request(`/api/finance/context?lessonId=${rounds[1].lessonId}&payerType=parent&payerId=${rounds[1].studentIds[0]}`, { cookie });
  assert.equal(context.response.status, 200, JSON.stringify(context.data));
  assert.equal(context.data.canConfirm, true);
  assert.equal(context.data.calculation.expectedAmount, 80);
  return { checks: ["课时财务上下文", "定价规则金额"], ok: true };
}

async function exerciseFinanceExceptions(cookie) {
  const month = rounds[1].today.slice(0, 7);
  const result = await request(`/api/finance/exceptions?month=${month}`, { cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(Array.isArray(result.data.exceptions));
  return { checks: ["月度财务异常扫描"], ok: true };
}

async function exerciseMiniBusiness(cookie) {
  const checks = [];
  const testCode = `${marker}_${randomBytes(6).toString("hex")}`;
  const login = await request("/api/mini/login", { cookie, method: "POST", body: { testCode, role: "teacher", displayName: "e2e教师" } });
  assert.equal(login.response.status, 200, JSON.stringify(login.data));
  const token = login.data.token;
  const accountId = Number(login.data.accountId);
  created.miniAccountIds.push(accountId);
  checks.push("小程序测试登录");
  const me = await request("/api/mini/me", { token });
  assert.equal(me.response.status, 200, JSON.stringify(me.data));
  assert.equal(me.data.role, "teacher");
  assert.equal(Number(me.data.accountId), accountId);
  checks.push("小程序身份读取");
  const portal = await request("/api/mini/portal?studentId=1", { token });
  assert.equal(portal.response.status, 400, JSON.stringify(portal.data));
  assert.match(String(portal.data.error || ""), /教师完整学情与财务请使用网站工作台/);
  checks.push("教师小程序入口隔离");
  const logout = await request("/api/mini/logout", { token, method: "POST" });
  assert.equal(logout.response.status, 200, JSON.stringify(logout.data));
  checks.push("小程序退出");
  return { checks, ok: true };
}

async function exercisePaperWorkbenchPagination(cookie) {
  const first = await request("/api/questions?status=active&page=1", { cookie });
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.ok(Array.isArray(first.data.questions));
  assert.ok(Number(first.data.total) > 0);
  assert.ok(Number(first.data.page) === 1);
  assert.ok(Number(first.data.pageCount) >= 1);
  const second = await request("/api/questions?status=active&page=2", { cookie });
  assert.equal(second.response.status, 200, JSON.stringify(second.data));
  const firstIds = new Set(first.data.questions.map((item) => Number(item.id)));
  assert.equal(Number(second.data.pageCount), Number(first.data.pageCount));
  if (Number(first.data.pageCount) > 1) {
    assert.ok(second.data.questions.every((item) => !firstIds.has(Number(item.id))), "第二页与第一页存在重复题目");
    assert.equal(Number(second.data.page), 2);
    assert.ok(second.data.questions.length >= 1);
    assert.ok(Number(first.data.total) > Number(first.data.questions.length));
  } else {
    assert.equal(Number(second.data.page), 1);
  }
  return { checks: ["组卷候选分页总数一致", "组卷候选加载更多不重复"], ok: true };
}

async function exerciseQuestionFacetCounts(cookie) {
  const checks = [];
  const facetKnowledge = `${marker}_facet_法治`;
  sql(`INSERT INTO questions(stem,question_type,stage,grade,knowledge_points,answer,analysis,status)
    VALUES(${quote(`${marker}_facet计数题`)},'单选题','高中','高一',${quote(facetKnowledge)},'A','facet','active');`);
  const facets = await request("/api/questions/facets?status=active", { cookie });
  assert.equal(facets.response.status, 200, JSON.stringify(facets.data));
  const knowledgeFacets = facets.data?.facets?.knowledge_points || [];
  const match = knowledgeFacets.find((item) => String(item.value) === facetKnowledge);
  assert.ok(match, JSON.stringify(knowledgeFacets));
  const storedCount = Number(rows(`SELECT COUNT(*) AS total FROM questions WHERE status='active' AND knowledge_points=${quote(facetKnowledge)}`)[0].total);
  assert.ok(Number(match.count) >= 1, JSON.stringify(match));
  assert.equal(Number(match.count), storedCount);
  checks.push("facet 返回 value/count 结构", "facet 计数与题量一致");
  return { checks, ok: true };
}

async function exerciseQuestionKnowledgeMultiKeyword(cookie) {
  const checks = [];
  const kwBase = marker.replaceAll("_", "");
  const kwA = `${kwBase}kwA`, kwB = `${kwBase}kwB`;
  sql(`INSERT INTO questions(stem,question_type,stage,grade,knowledge_points,secondary_knowledge,answer,analysis,status) VALUES
    (${quote(`${marker}_双词主知识点`)},'单选题','高中','高一',${quote(`${kwA} ${kwB}`)},NULL,'A','x','active'),
    (${quote(`${marker}_单词主知识点`)},'单选题','高中','高一',${quote(kwA)},NULL,'A','x','active'),
    (${quote(`${marker}_跨列命中`)},'单选题','高中','高一',${quote(kwA)},${quote(kwB)},'A','x','active'),
    (${quote(`${marker}_百分号字面量`)},'单选题','高中','高一',${quote(`${kwA}%${kwB}`)},NULL,'A','x','active'),
    (${quote(`${marker}_下划线字面量`)},'单选题','高中','高一',${quote(`${kwA}_${kwB}`)},NULL,'A','x','active');`);
  const andSpace = await request(`/api/questions?status=active&knowledge=${encodeURIComponent(`${kwA} ${kwB}`)}`, { cookie });
  assert.equal(andSpace.response.status, 200, JSON.stringify(andSpace.data));
  const spaceStems = andSpace.data.questions.map((item) => String(item.stem));
  assert.ok(spaceStems.includes(`${marker}_双词主知识点`), JSON.stringify(spaceStems));
  assert.ok(spaceStems.includes(`${marker}_跨列命中`), JSON.stringify(spaceStems));
  assert.ok(!spaceStems.includes(`${marker}_单词主知识点`), JSON.stringify(spaceStems));
  const andDun = await request(`/api/questions?status=active&knowledge=${encodeURIComponent(`${kwA}、${kwB}`)}`, { cookie });
  assert.equal(andDun.response.status, 200, JSON.stringify(andDun.data));
  assert.equal(andDun.data.total, andSpace.data.total, "空格与、分隔应等价");
  checks.push("知识点多关键词 AND 命中", "空格与、分隔等价");
  const percent = await request(`/api/questions?status=active&knowledge=${encodeURIComponent("%")}`, { cookie });
  assert.equal(percent.response.status, 200, JSON.stringify(percent.data));
  const percentStems = percent.data.questions.map((item) => String(item.stem));
  assert.ok(percentStems.includes(`${marker}_百分号字面量`), JSON.stringify(percentStems));
  assert.ok(!percentStems.includes(`${marker}_下划线字面量`), JSON.stringify(percentStems));
  assert.ok(percent.data.questions.every((item) => String(item.knowledgePoints || "").includes("%") || String(item.secondaryKnowledge || "").includes("%")), JSON.stringify(percent.data.questions));
  const underscore = await request(`/api/questions?status=active&knowledge=${encodeURIComponent("_")}`, { cookie });
  assert.equal(underscore.response.status, 200, JSON.stringify(underscore.data));
  const underscoreStems = underscore.data.questions.map((item) => String(item.stem));
  assert.ok(underscoreStems.includes(`${marker}_下划线字面量`), JSON.stringify(underscoreStems));
  assert.ok(!underscoreStems.includes(`${marker}_百分号字面量`), JSON.stringify(underscoreStems));
  assert.ok(underscore.data.questions.every((item) => String(item.knowledgePoints || "").includes("_") || String(item.secondaryKnowledge || "").includes("_")), JSON.stringify(underscore.data.questions));
  checks.push("百分号与下划线按字面匹配");
  return { checks, ok: true };
}

async function exercisePaperRecommendationAllCandidates(cookie) {
  const checks = [];
  const candidateKnowledge = `${marker}_all_candidates`;
  const rowsSql = Array.from({ length: 1220 }, (_, index) =>
    `(${quote(`${marker}_候选全集${String(index + 1).padStart(3, "0")}`)},'单选题','高中','高一',${quote(candidateKnowledge)},'A','候选全集','active')`
  ).join(",");
  sql(`INSERT INTO questions(stem,question_type,stage,grade,knowledge_points,answer,analysis,status) VALUES ${rowsSql};`);
  const result = await request(`/api/questions?status=active&knowledge=${encodeURIComponent(candidateKnowledge)}&candidate=1`, { cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const allIds = Array.isArray(result.data.allIds) ? result.data.allIds.map(Number) : [];
  const total = Number(result.data.total);
  const storedCount = Number(rows(`SELECT COUNT(*) AS total FROM questions WHERE status='active' AND knowledge_points=${quote(candidateKnowledge)}`)[0].total);
  assert.ok(total >= 1220, `候选 total=${total}`);
  assert.equal(storedCount, total);
  assert.equal(Number(result.data.candidateTotal), total);
  assert.equal(Boolean(result.data.candidateLimited), true, "超过有界候选池时必须明确 limited");
  assert.ok(allIds.length <= 1200, `allIds=${allIds.length} total=${total}`);
  assert.ok(allIds.length < total, `candidate=1 不应返回整套 ID：allIds=${allIds.length} total=${total}`);
  assert.equal(new Set(allIds).size, allIds.length, "candidate=1 的 allIds 不应重复");
  checks.push("candidate=1 候选 ID 池有界", "candidate=1 总数独立返回且无重复");
  return { checks, ok: true };
}

async function exerciseBusinessCoverage(cookie) {
  const modules = [
    ["recognition", exerciseRecognitionBusiness],
    ["resources", exerciseResourcesBusiness],
    ["reflections", exerciseReflectionsBusiness],
    ["questionViews", exerciseQuestionViewsBusiness],
    ["scheduleImports", exerciseScheduleImportsBusiness],
    ["examProjects", exerciseExamProjectsBusiness],
    ["questionSets", exerciseQuestionSetsBusiness],
    ["financeContext", exerciseFinanceContext],
    ["financeExceptions", exerciseFinanceExceptions],
    ["mini", exerciseMiniBusiness],
    ["paperWorkbenchPagination", exercisePaperWorkbenchPagination],
    ["questionFacetCounts", exerciseQuestionFacetCounts],
    ["questionKnowledgeMultiKeyword", exerciseQuestionKnowledgeMultiKeyword],
    ["paperRecommendationAllCandidates", exercisePaperRecommendationAllCandidates],
  ];
  const results = {};
  for (const [name, run] of modules) results[name] = await run(cookie);
  return results;
}

let rounds = [];

try {
  const aiMockBase = await startAiMock();
  await writeFile(devVars, `TEACHER_ADMIN_ACCOUNT=${marker}\nTEACHER_ADMIN_PASSWORD=${e2ePassword}\nTEACHER_ADMIN_SESSION_SECRET=${e2eSessionSecret}\nDEEPSEEK_AI_ENABLED=true\nDEEPSEEK_API_KEY=local-e2e-only\nDEEPSEEK_API_BASE=${aiMockBase}\nWECHAT_TEST_MODE=true\n`, { mode: 0o600 });
  const devServerCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  server = spawn(process.execPath, [devServerCli, "dev"], {
    cwd: root,
    env: {
      ...process.env,
      CLOUDFLARE_ENV: "e2e",
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    rounds = [await exerciseRound(1, cookie), await exerciseRound(2, cookie)];
    const businessCoverage = await exerciseBusinessCoverage(cookie);
    cleanup();
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ ok: true, localOnly: true, access, demo, ai, rounds, businessCoverage, generatedAt: new Date().toISOString() }, null, 2));
    const totalChecks = Object.values(businessCoverage).reduce((sum, module) => sum + module.checks.length, 0);
    console.log(`综合演示数据、DeepSeek 本地模拟与今日教学闭环回归通过：AI 隐私/学习/题库审核完整链路 1 轮，教学闭环 ${rounds.length} 轮，业务级覆盖 ${Object.keys(businessCoverage).length} 个模块共 ${totalChecks} 项检查；报告 ${path.relative(root, reportPath)}`);
  }
} finally {
  try { cleanup(); } catch {}
  sqlite.close();
  if (server && !server.killed) server.kill("SIGINT");
  if (aiMockServer) await new Promise((resolve) => aiMockServer.close(resolve));
  await rm(devVars, { force: true });
}
