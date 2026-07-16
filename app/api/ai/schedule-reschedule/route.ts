import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, sanitizeForAi } from "../../../lib/ai/server";
import { buildRescheduleCandidates, type RescheduleCandidate } from "../../../lib/schedule-reschedule";

const priorities = ["首选", "备选", "谨慎"] as const;
type RankedOption = { candidateId: string; priority: typeof priorities[number]; reason: string; tradeoffs: string[] };
type RescheduleDraft = { summary: string; options: Array<RankedOption & RescheduleCandidate>; teacherChecks: string[]; uncertainty: string[] };
const text = (value: unknown) => String(value || "").trim();
const stringList = (value: unknown, limit = 20) => Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, limit) : [];

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function validateDraft(value: unknown, candidates: RescheduleCandidate[]): RescheduleDraft {
  const row = value as Record<string, unknown>, candidateMap = new Map(candidates.map((item) => [item.candidateId, item]));
  if (!row || typeof row !== "object" || Array.isArray(row) || !text(row.summary) || !Array.isArray(row.options)) throw new AiServiceError("AI 调课建议结构无效，结果未采用", 502, "SCHEMA_INVALID");
  const seen = new Set<string>(), options = row.options.slice(0, 5).map((item) => {
    const option = item as Record<string, unknown>, candidateId = text(option.candidateId), candidate = candidateMap.get(candidateId), priority = text(option.priority) as RankedOption["priority"];
    if (!candidate || seen.has(candidateId) || !priorities.includes(priority) || !text(option.reason)) throw new AiServiceError("AI 调课建议引用了非真实空档，结果未采用", 502, "SCHEMA_INVALID");
    seen.add(candidateId);
    return { ...candidate, candidateId, priority, reason: text(option.reason), tradeoffs: stringList(option.tradeoffs, 10) };
  });
  if (!options.length) throw new AiServiceError("AI 调课建议没有可用方案，结果未采用", 502, "SCHEMA_INVALID");
  return { summary: text(row.summary), options, teacherChecks: stringList(row.teacherChecks), uncertainty: stringList(row.uncertainty) };
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; const roleDenied = requireAiTeacher(access); if (roleDenied) return roleDenied;
  let lessonId = 0;
  try {
    const body = await request.json() as Record<string, unknown>; lessonId = Number(body.lessonId || 0);
    if (!lessonId) return Response.json({ error: "请先打开一节课，再生成 AI 调课建议" }, { status: 400 });
    const accessDenied = await requireLessonAccess(access, lessonId); if (accessDenied) return accessDenied;
    const lesson = await env.DB.prepare("SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.mode,l.location,l.course_name AS courseName,l.stage,l.grade,l.topic,l.status,c.course_type AS courseType FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.id=?").bind(lessonId).first<Record<string, any>>();
    if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
    if (["completed", "cancelled"].includes(String(lesson.status))) return Response.json({ error: "已完成或已取消的课时不能生成调课建议" }, { status: 409 });
    if (!text(lesson.startTime) || !text(lesson.endTime)) return Response.json({ error: "请先补齐课时的开始和结束时间" }, { status: 409 });
    const endDate = new Date(`${lesson.date}T12:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() + 14);
    const occupied = await env.DB.prepare("SELECT id,date,start_time AS startTime,end_time AS endTime,status FROM lessons WHERE id!=? AND status!='cancelled' AND date BETWEEN ? AND ? AND TRIM(COALESCE(start_time,''))<>'' AND TRIM(COALESCE(end_time,''))<>'' ORDER BY date,start_time").bind(lessonId, lesson.date < chinaDate() ? chinaDate() : lesson.date, endDate.toISOString().slice(0, 10)).all<Record<string, any>>();
    const candidates = buildRescheduleCandidates(lesson as any, occupied.results as any, chinaDate(), 8);
    if (!candidates.length) return Response.json({ error: "未来14天内没有符合当前课时时长的真实空档，请人工扩大范围" }, { status: 409 });
    const sentFields = ["原课时日期、时间、课程类型、课程名称与上课地点", "系统根据现有课表排除冲突后计算的候选空档"];
    const excludedFields = ["学生姓名和联系方式", "家长、学校与微信标识", "其他课时的学生与教学内容", "在线课堂链接", "登录、会话和密钥数据"];
    const payload = sanitizeForAi({ instruction: "严格输出 JSON。候选时间已由系统根据真实课表排除冲突；你只能从 candidates 中选择 candidateId 并排序说明，不能新增或修改日期、时间、地点。优先兼顾原时间接近程度与教师操作成本；无法判断学生和场地是否最终可用，必须写入 teacherChecks。结果仅为待确认建议，不能自动改课。", originalLesson: lesson, candidates, allowedPriorities: priorities, sentFields, excludedFields, requiredJsonExample: { summary: "字符串", options: [{ candidateId: candidates[0].candidateId, priority: "首选", reason: "字符串", tradeoffs: ["字符串"] }], teacherChecks: ["字符串"], uncertainty: ["字符串"] } }, []);
    const result = await callDeepSeekJson<RescheduleDraft>({ access, feature: "schedule_reschedule", entityType: "lesson", entityId: lessonId, system: "你是教师课表调课辅助。只输出 JSON；只能排序系统给出的真实空档，不自动修改课时。", payload, thinking: true, useProModel: false, maxTokens: 2400, validate: (value) => validateDraft(value, candidates) });
    await audit(access, "generate", "ai_schedule_reschedule", lessonId, { runId: result.runId, model: result.model, candidateIds: candidates.map((item) => item.candidateId), sentFields, excludedFields });
    return Response.json({ draft: result.data, runId: result.runId, sentFields, excludedFields, notice: "AI 仅对真实空档排序；课时尚未修改，调课前仍需教师确认学生与场地。" });
  } catch (error) { await audit(access, "generate_failed", "ai_schedule_reschedule", lessonId || null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
