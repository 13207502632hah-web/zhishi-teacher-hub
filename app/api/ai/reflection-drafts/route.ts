import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, sanitizeForAi } from "../../../lib/ai/server";

const problemTypes = ["课堂节奏", "知识理解", "材料分析", "规范表达", "课堂参与", "作业落实", "价值引领", "其他"];
type ReflectionDraft = { problemType: string; tags: string; expectedVsActual: string; effectivePractices: string; difficulties: string; studentEvidence: string; nextAction: string; reusableMaterial: string; evidenceSummary: string[]; uncertainty: string[] };
const requiredText = ["expectedVsActual", "effectivePractices", "difficulties", "studentEvidence", "nextAction", "reusableMaterial"] as const;
const text = (value: unknown) => String(value || "").trim();

function validateReflection(value: unknown): ReflectionDraft {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new AiServiceError("AI 反思草案结构无效，结果未采用", 502, "SCHEMA_INVALID");
  for (const key of requiredText) if (typeof row[key] !== "string" || !text(row[key])) throw new AiServiceError(`AI 反思草案缺少“${key}”，结果未采用`, 502, "SCHEMA_INVALID");
  const problemType = problemTypes.includes(text(row.problemType)) ? text(row.problemType) : "";
  return { problemType, tags: text(row.tags), ...Object.fromEntries(requiredText.map((key) => [key, text(row[key])])), evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary.map(String).slice(0, 20) : [], uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty.map(String).slice(0, 20) : [] } as ReflectionDraft;
}

export async function POST(request: Request) {
  const access = await requirePermission("reflections:write"); if (isDenied(access)) return access; const roleDenied = requireAiTeacher(access); if (roleDenied) return roleDenied;
  let lessonId = 0;
  try {
    const body = await request.json() as Record<string, unknown>; lessonId = Number(body.lessonId || 0);
    if (!lessonId) return Response.json({ error: "请先关联一节课，再生成 AI 反思草案" }, { status: 400 });
    const accessDenied = await requireLessonAccess(access, lessonId); if (accessDenied) return accessDenied;
    const lesson = await env.DB.prepare("SELECT id,date,course_name AS courseName,stage,grade,topic,knowledge_points AS knowledgePoints,teaching_goals AS teachingGoals,key_points AS keyPoints,difficult_points AS difficultPoints,actual_content AS actualContent,homework,next_plan AS nextPlan,participation,understanding,completion,discipline,status FROM lessons WHERE id=?").bind(lessonId).first<Record<string, any>>();
    if (!lesson) return Response.json({ error: "关联课时不存在" }, { status: 404 });
    const [attendance, records, assignments, studentNames] = await Promise.all([
      env.DB.prepare("SELECT status,COUNT(*) AS count FROM attendance WHERE lesson_id=? GROUP BY status ORDER BY status").bind(lessonId).all<Record<string, any>>(),
      env.DB.prepare("SELECT participation,understanding,completion,teacher_note AS teacherNote,risk_tags AS riskTags,risk_confirmed AS riskConfirmed FROM student_lesson_records WHERE lesson_id=? ORDER BY student_id").bind(lessonId).all<Record<string, any>>(),
      env.DB.prepare("SELECT a.title,a.status,a.due_at AS dueAt,COUNT(s.id) AS studentCount,SUM(CASE WHEN s.status IN ('completed','corrected') THEN 1 ELSE 0 END) AS completedCount FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id WHERE a.lesson_id=? GROUP BY a.id ORDER BY a.created_at").bind(lessonId).all<Record<string, any>>(),
      env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>(),
    ]);
    const notes = records.results.filter((item) => text(item.teacherNote) || text(item.riskTags));
    const sentFields = ["课时日期、课程、课题、已有知识点和备课目标", "实际教学内容、课堂整体评分、作业和下节计划", ...(attendance.results.length ? ["匿名出勤汇总"] : []), ...(records.results.length ? ["匿名学生课堂评分、教师备注和已确认关注标签"] : []), ...(assignments.results.length ? ["作业完成汇总"] : [])];
    const excludedFields = ["学生姓名和联系方式", "家长与微信标识", "反馈发布内容", "附件与登录、会话和密钥数据"];
    const payload = sanitizeForAi({ instruction: "严格输出 JSON。只根据真实课时记录做教学复盘，不得编造学生表现、心理判断、政策事实、教材观点或教学成效。没有证据必须写‘信息不足’。问题类型只能从给定列表选择。nextAction 必须具体可执行；所有内容只是待教师修改的私密草案。", allowedProblemTypes: problemTypes, lesson, attendanceSummary: attendance.results, anonymousStudentRecords: records.results, assignmentSummary: assignments.results, sentFields, excludedFields, requiredJsonExample: { problemType: "材料分析", tags: "材料分析,规范表达", expectedVsActual: "字符串", effectivePractices: "字符串", difficulties: "字符串", studentEvidence: "字符串", nextAction: "字符串", reusableMaterial: "字符串", evidenceSummary: ["字符串"], uncertainty: ["字符串"] } }, studentNames.results.map((item) => String(item.name)));
    const result = await callDeepSeekJson<ReflectionDraft>({ access, feature: "reflection_draft", entityType: "lesson", entityId: lessonId, system: "你是教师私密教学反思助手。只输出 JSON；以证据为边界，不做心理诊断，不自动保存或公开。", payload, thinking: true, useProModel: false, maxTokens: 3400, validate: validateReflection });
    const draft = { ...result.data }, uncertainty = [...draft.uncertainty];
    if (!text(lesson.teachingGoals) || !text(lesson.actualContent)) { draft.expectedVsActual = "信息不足"; uncertainty.push("缺少教学目标或实际教学内容，预设与实际差异未生成"); }
    if (!notes.length && !text(lesson.participation) && !text(lesson.understanding) && !text(lesson.completion)) { draft.effectivePractices = "信息不足"; draft.difficulties = "信息不足"; uncertainty.push("缺少课堂表现评分或教师备注，有效做法与困难未生成"); }
    await audit(access, "generate", "ai_reflection_draft", lessonId, { runId: result.runId, model: result.model, sentFields, excludedFields });
    return Response.json({ draft: { ...draft, uncertainty }, runId: result.runId, sentFields, excludedFields, notice: "AI 反思仍是私密未保存草案；采用后需教师逐项核对并点击私密保存。" });
  } catch (error) { await audit(access, "generate_failed", "ai_reflection_draft", lessonId || null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
