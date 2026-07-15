import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, sanitizeForAi } from "../../../lib/ai/server";
import { getLearningExamples } from "../../../lib/ai/learning";

type ClosureDraft = {
  classroomSummary: string;
  highlights: string;
  consolidate: string;
  homeworkSuggestion: string;
  nextLessonPlan: string;
  parentMessage: string;
  reflectionOutline: string;
  evidenceSummary: string[];
  uncertainty: string[];
};

const requiredText = ["classroomSummary", "highlights", "consolidate", "homeworkSuggestion", "nextLessonPlan", "parentMessage", "reflectionOutline"] as const;
function validateDraft(value: unknown): ClosureDraft {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new AiServiceError("AI 草稿结构无效，结果未保存", 502, "SCHEMA_INVALID");
  for (const key of requiredText) if (typeof row[key] !== "string" || !String(row[key]).trim()) throw new AiServiceError(`AI 草稿缺少“${key}”，结果未保存`, 502, "SCHEMA_INVALID");
  return { ...Object.fromEntries(requiredText.map((key) => [key, String(row[key]).trim()])), evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary.map(String).slice(0, 20) : [], uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty.map(String).slice(0, 20) : [] } as ClosureDraft;
}

export async function GET() {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const rows = await env.DB.prepare("SELECT d.id,d.run_id AS runId,d.lesson_id AS lessonId,d.student_id AS studentId,d.sent_fields_json AS sentFieldsJson,d.draft_json AS draftJson,d.status,d.created_at AS createdAt,l.date,l.course_name AS courseName,s.name AS studentName FROM ai_feedback_drafts d JOIN lessons l ON l.id=d.lesson_id LEFT JOIN students s ON s.id=d.student_id WHERE d.user_id=? AND d.status='pending' ORDER BY d.created_at DESC LIMIT 50").bind(access.id).all<Record<string, any>>();
  return Response.json({ drafts: rows.results.map((row) => ({ ...row, sentFields: JSON.parse(row.sentFieldsJson || "[]"), draft: JSON.parse(row.draftJson || "{}") })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const body = await request.json() as { id?: unknown }, id = Number(body.id || 0);
  if (!id) return Response.json({ error: "缺少要放弃的草稿" }, { status: 400 });
  const result = await env.DB.prepare("UPDATE ai_feedback_drafts SET status='discarded',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='pending'").bind(id, access.id).run();
  if (!Number(result.meta?.changes || 0)) return Response.json({ error: "草稿不存在、无权操作或已处理" }, { status: 404 });
  await audit(access, "discard", "ai_feedback_draft", id);
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, any>, lessonId = Number(body.lessonId || 0), studentId = Number(body.studentId || 0), audience = String(body.audience || "private"), tone = String(body.tone || "温和鼓励");
    if (!lessonId) return Response.json({ error: "请先选择关联课时，再生成 AI 草稿" }, { status: 400 });
    const [lesson, student, record, attendance, assignments, submissions, settings, studentNames] = await Promise.all([
      env.DB.prepare("SELECT id,class_id AS classId,date,course_name AS courseName,stage,grade,topic,knowledge_points AS knowledgePoints,actual_content AS actualContent,homework,next_plan AS nextPlan,participation,understanding,completion FROM lessons WHERE id=?").bind(lessonId).first<Record<string, any>>(),
      studentId ? env.DB.prepare("SELECT id,name,grade,foundation_level AS foundationLevel,weak_knowledge AS weakKnowledge,learning_habits AS learningHabits,stage_goal AS stageGoal FROM students WHERE id=?").bind(studentId).first<Record<string, any>>() : Promise.resolve(null),
      studentId ? env.DB.prepare("SELECT participation,understanding,completion,teacher_note AS teacherNote,risk_tags AS riskTags,risk_confirmed AS riskConfirmed FROM student_lesson_records WHERE lesson_id=? AND student_id=?").bind(lessonId, studentId).first<Record<string, any>>() : Promise.resolve(null),
      env.DB.prepare("SELECT a.status,a.notes FROM attendance a WHERE a.lesson_id=? AND (?=0 OR a.student_id=?) ORDER BY a.student_id").bind(lessonId, studentId, studentId).all<Record<string, any>>(),
      env.DB.prepare("SELECT id,title,requirements,due_at AS dueAt,status FROM assignments WHERE lesson_id=? ORDER BY created_at").bind(lessonId).all<Record<string, any>>(),
      studentId ? env.DB.prepare("SELECT a.title,s.status,s.score,s.review_tags AS reviewTags,s.teacher_note AS teacherNote FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.lesson_id=? AND s.student_id=?").bind(lessonId, studentId).all<Record<string, any>>() : Promise.resolve({ results: [] }),
      env.DB.prepare("SELECT include_student_name AS includeStudentName FROM ai_settings WHERE user_id=?").bind(access.id).first<{ includeStudentName: number }>(),
      env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>(),
    ]);
    if (!lesson) return Response.json({ error: "关联课时不存在" }, { status: 404 });
    if (studentId && !student) return Response.json({ error: "关联学生不存在" }, { status: 404 });
    if (studentId && lesson.classId) { const enrolled = await env.DB.prepare("SELECT 1 AS enrolled FROM enrollments WHERE student_id=? AND class_id=? AND status='active'").bind(studentId, lesson.classId).first(); if (!enrolled) return Response.json({ error: "所选学生不属于该课时班级，未调用 DeepSeek" }, { status: 400 }); }
    const includeName = Boolean(settings?.includeStudentName), allNames = studentNames.results.map((item) => String(item.name)), targetName = student?.name ? String(student.name) : "", redactNames = includeName && targetName ? allNames.filter((name) => name !== targetName) : allNames, examples = await getLearningExamples(access, audience, tone, String(lesson.stage || ""), String(lesson.grade || ""));
    const teacherInput = { previousHomework: body.previousHomework, classPerformance: body.classPerformance, weakPoints: body.weakPoints, customInput: body.customInput };
    const sentFields = ["课时日期、课程、学段、年级、课题与知识点", ...(lesson.actualContent || lesson.homework || lesson.nextPlan ? ["实际教学内容、课内作业和下节计划"] : []), ...(student && (student.foundationLevel || student.weakKnowledge || student.learningHabits || student.stageGoal) ? ["学生基础水平、薄弱知识、学习习惯和阶段目标"] : []), ...(record || lesson.participation || lesson.understanding || lesson.completion ? ["课堂表现与教师学情备注"] : []), ...(attendance.results.length ? ["出勤记录"] : []), ...(assignments.results.length || submissions.results.length ? ["课后作业及本学生完成情况"] : []), ...(Object.values(teacherInput).some((value) => String(value || "").trim()) ? ["教师本次补充"] : []), ...(examples.length ? ["同场景脱敏写作样例"] : []), ...(includeName && student?.name ? ["学生姓名"] : [])];
    const excludedFields = ["监护人联系方式", "微信标识", "附件原件与文件地址", "登录、会话和密钥数据"];
    const lessonForAi = { date: lesson.date, courseName: lesson.courseName, stage: lesson.stage, grade: lesson.grade, topic: lesson.topic, knowledgePoints: lesson.knowledgePoints, actualContent: lesson.actualContent, homework: lesson.homework, nextPlan: lesson.nextPlan, participation: lesson.participation, understanding: lesson.understanding, completion: lesson.completion };
    const studentForAi = student ? { name: includeName ? student.name : "【学生】", grade: student.grade, foundationLevel: student.foundationLevel, weakKnowledge: student.weakKnowledge, learningHabits: student.learningHabits, stageGoal: student.stageGoal } : null;
    const assignmentForAi = assignments.results.map((item) => ({ title: item.title, requirements: item.requirements, dueAt: item.dueAt, status: item.status }));
    const input = sanitizeForAi({ instruction: "严格输出 JSON。只根据真实记录整理以下七段；缺少证据的段落必须填写“信息不足”，不得编造事实、政策、教材观点、答案或心理诊断。parentMessage 只是待教师确认的家长沟通稿，不能声称已经发送。", audience, tone, teacherInput, lesson: lessonForAi, student: studentForAi, studentLessonRecord: record, attendance: attendance.results, assignments: assignmentForAi, studentSubmissions: submissions.results, teacherStyleExamples: examples, sentFields, excludedFields, requiredJsonExample: { classroomSummary: "字符串", highlights: "字符串", consolidate: "字符串", homeworkSuggestion: "字符串", nextLessonPlan: "字符串", parentMessage: "字符串", reflectionOutline: "字符串", evidenceSummary: ["字符串"], uncertainty: ["字符串"] } }, redactNames);
    if (body.preview === true) return Response.json({ sentFields, excludedFields, includeStudentName: includeName && Boolean(student?.name), notice: "这是服务器按当前课时与学生计算的实际发送字段；尚未调用 DeepSeek。" });
    const result = await callDeepSeekJson<ClosureDraft>({ access, feature: "feedback_draft", entityType: "lesson", entityId: lessonId, system: "你是教师后台的课后闭环草稿助手。仅输出一个 JSON 对象，不使用 Markdown。所有判断必须有输入证据；信息不足必须明示。", payload: input, thinking: false, useProModel: false, maxTokens: 2600, validate: validateDraft });
    const resolved = { ...result.data }, missingEvidence: string[] = [];
    if (!lesson.actualContent && !lesson.topic && !String(body.customInput || "").trim()) { resolved.classroomSummary = "信息不足"; missingEvidence.push("缺少实际教学内容或课题，课堂小结已标记信息不足"); }
    if (!record && !lesson.participation && !lesson.understanding && !lesson.completion && !String(body.classPerformance || "").trim()) { resolved.highlights = "信息不足"; missingEvidence.push("缺少课堂表现记录，表现亮点已标记信息不足"); }
    if (!record?.riskTags && !record?.teacherNote && !student?.weakKnowledge && !String(body.weakPoints || "").trim()) { resolved.consolidate = "信息不足"; missingEvidence.push("缺少薄弱点证据，需要巩固已标记信息不足"); }
    if (!lesson.homework && !assignments.results.length && !submissions.results.length && !String(body.previousHomework || "").trim()) { resolved.homeworkSuggestion = "信息不足"; missingEvidence.push("缺少作业记录，作业建议已标记信息不足"); }
    if (!lesson.nextPlan) { resolved.nextLessonPlan = "信息不足"; missingEvidence.push("缺少教师记录的下节课目标，下节课计划已标记信息不足"); }
    if (resolved.classroomSummary === "信息不足" && resolved.highlights === "信息不足") resolved.reflectionOutline = "信息不足";
    const draft = { content: resolved.parentMessage, shortContent: resolved.parentMessage, standardContent: resolved.parentMessage, learningContent: resolved.classroomSummary, highlights: resolved.highlights, consolidate: resolved.consolidate, homeworkRequirements: resolved.homeworkSuggestion, nextFocus: resolved.nextLessonPlan, parentAdvice: resolved.parentMessage, reflectionOutline: resolved.reflectionOutline, evidenceSummary: resolved.evidenceSummary, uncertainty: [...resolved.uncertainty, ...missingEvidence] };
    const saved = await env.DB.prepare("INSERT INTO ai_feedback_drafts(run_id,user_id,lesson_id,student_id,sent_fields_json,draft_json) VALUES(?,?,?,?,?,?) RETURNING id").bind(result.runId, access.id, lessonId, studentId || null, JSON.stringify(sentFields), JSON.stringify(draft)).first<{ id: number }>();
    await audit(access, "generate", "ai_feedback_draft", saved?.id || result.runId, { runId: result.runId, lessonId, studentId: studentId || null, model: result.model, sentFields, excludedFields });
    return Response.json({ draft: { ...draft, aiDraftId: saved?.id }, runId: result.runId, sentFields, excludedFields, notice: "AI 仅生成可恢复的未发布草稿，教师逐项核对后才能保存为反馈。" });
  } catch (error) { await audit(access, "generate_failed", "ai_feedback_draft", null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
