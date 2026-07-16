import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission, requireStudentAccess } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, sanitizeForAi } from "../../../lib/ai/server";

const tierLevels = ["基础巩固", "重点突破", "迁移提升"] as const;
type RemediationTier = { level: typeof tierLevels[number]; target: string; evidence: string[]; actions: string[]; wrongQuestionIds: number[] };
type RemediationDraft = { summary: string; tiers: RemediationTier[]; correctionSteps: string[]; teacherChecks: string[]; uncertainty: string[] };
const text = (value: unknown) => String(value || "").trim();

function stringList(value: unknown, limit = 20) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, limit) : [];
}

function validateDraft(value: unknown, allowedIds: Set<number>): RemediationDraft {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || Array.isArray(row) || !text(row.summary)) throw new AiServiceError("AI 订正建议结构无效，结果未采用", 502, "SCHEMA_INVALID");
  if (!Array.isArray(row.tiers) || !row.tiers.length) throw new AiServiceError("AI 订正建议缺少分层方案，结果未采用", 502, "SCHEMA_INVALID");
  const seen = new Set<string>();
  const tiers = row.tiers.slice(0, 3).map((item) => {
    const tier = item as Record<string, unknown>, level = text(tier.level) as RemediationTier["level"];
    const ids = Array.isArray(tier.wrongQuestionIds) ? [...new Set(tier.wrongQuestionIds.map(Number).filter((id) => allowedIds.has(id)))].slice(0, 20) : [];
    if (!tierLevels.includes(level) || seen.has(level) || !text(tier.target) || !ids.length || !stringList(tier.actions).length) throw new AiServiceError("AI 订正建议引用了无效层级或错题，结果未采用", 502, "SCHEMA_INVALID");
    seen.add(level);
    return { level, target: text(tier.target), evidence: stringList(tier.evidence), actions: stringList(tier.actions), wrongQuestionIds: ids };
  });
  return { summary: text(row.summary), tiers, correctionSteps: stringList(row.correctionSteps), teacherChecks: stringList(row.teacherChecks), uncertainty: stringList(row.uncertainty) };
}

export async function POST(request: Request) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access; const roleDenied = requireAiTeacher(access); if (roleDenied) return roleDenied;
  let studentId = 0;
  try {
    const body = await request.json() as Record<string, unknown>; studentId = Number(body.studentId || 0);
    if (!studentId) return Response.json({ error: "请先打开一名学生，再生成分层订正建议" }, { status: 400 });
    const accessDenied = await requireStudentAccess(access, studentId); if (accessDenied) return accessDenied;
    const [student, wrongQuestions, studentNames] = await Promise.all([
      env.DB.prepare("SELECT grade,foundation_level AS foundationLevel,weak_knowledge AS weakKnowledge,learning_habits AS learningHabits,stage_goal AS stageGoal FROM students WHERE id=?").bind(studentId).first<Record<string, any>>(),
      env.DB.prepare("SELECT w.id AS wrongQuestionId,w.question_id AS questionId,w.incorrect_answer AS incorrectAnswer,w.reason,w.occurred_at AS occurredAt,q.stem,q.question_type AS questionType,q.difficulty,q.knowledge_points AS knowledgePoints,q.answer,q.analysis,l.date AS lessonDate,l.topic AS lessonTopic FROM wrong_questions w JOIN questions q ON q.id=w.question_id AND q.status='active' LEFT JOIN lessons l ON l.id=w.lesson_id WHERE w.student_id=? AND w.status='active' ORDER BY w.occurred_at DESC,w.id DESC LIMIT 30").bind(studentId).all<Record<string, any>>(),
      env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>(),
    ]);
    if (!student) return Response.json({ error: "学生不存在" }, { status: 404 });
    if (!wrongQuestions.results.length) return Response.json({ error: "该学生暂无教师已登记且仍待巩固的错题" }, { status: 409 });
    const allowedIds = new Set(wrongQuestions.results.map((item) => Number(item.wrongQuestionId)));
    const sentFields = ["匿名年级与教师已记录的学习基础", "教师已登记且仍待巩固的错题题干、题型与知识点", "正式题库中的既有答案与解析", "学生本次作答与教师错因备注"];
    const excludedFields = ["学生姓名和联系方式", "家长、学校与微信标识", "已掌握错题", "附件原件与文件地址", "登录、会话和密钥数据"];
    const payload = sanitizeForAi({ instruction: "严格输出 JSON。只根据输入中教师已登记且仍待巩固的错题形成基础巩固、重点突破、迁移提升三层订正建议。不得新增题目、标准答案、教材观点、政策事实或学生心理判断；只能引用输入中的 wrongQuestionId。每项建议必须具体、可检查，证据不足时写入 uncertainty。结果仅供教师确认，不得自动布置。", anonymousStudentProfile: student, confirmedActiveWrongQuestions: wrongQuestions.results, allowedTierLevels: tierLevels, sentFields, excludedFields, requiredJsonExample: { summary: "字符串", tiers: [{ level: "基础巩固", target: "字符串", evidence: ["字符串"], actions: ["字符串"], wrongQuestionIds: [1] }], correctionSteps: ["字符串"], teacherChecks: ["字符串"], uncertainty: ["字符串"] } }, studentNames.results.map((item) => String(item.name)));
    const result = await callDeepSeekJson<RemediationDraft>({ access, feature: "wrong_question_remediation", entityType: "student", entityId: studentId, system: "你是教师后台的错题订正辅助。只输出 JSON；只用已确认记录，不编造题目或学生结论，不自动布置。", payload, thinking: true, useProModel: false, maxTokens: 3200, validate: (value) => validateDraft(value, allowedIds) });
    await audit(access, "generate", "ai_wrong_question_remediation", studentId, { runId: result.runId, model: result.model, wrongQuestionIds: [...allowedIds], sentFields, excludedFields });
    return Response.json({ draft: result.data, runId: result.runId, sentFields, excludedFields, notice: "AI 分层订正建议未写入作业或学生档案；请教师核对后再决定是否采用。" });
  } catch (error) { await audit(access, "generate_failed", "ai_wrong_question_remediation", studentId || null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
