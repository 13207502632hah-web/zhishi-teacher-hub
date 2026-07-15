import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, SAFE_QUESTION_FIELDS, SENSITIVE_QUESTION_FIELDS } from "../../../lib/ai/server";

const fieldColumns: Record<string, string> = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level" };
type ReviewResult = { questionId: number; safeSuggestions?: Record<string, unknown>; sensitiveSuggestions?: Record<string, unknown>; confidence?: Record<string, number>; reasons?: Record<string, string> };
const allFields = [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS] as readonly string[];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validateReviewBatch(value: unknown, batchIds: number[]) {
  if (!isObject(value) || !Array.isArray(value.reviews) || value.reviews.length !== batchIds.length) throw new AiServiceError("AI 未返回完整题目审核结果，当前批次未推进", 502, "SCHEMA_INVALID");
  const expected = new Set(batchIds), seen = new Set<number>(), reviews: ReviewResult[] = [];
  for (const candidate of value.reviews) {
    if (!isObject(candidate) || !Number.isInteger(Number(candidate.questionId)) || !expected.has(Number(candidate.questionId)) || seen.has(Number(candidate.questionId))) throw new AiServiceError("AI 审核题号不完整或重复，当前批次未推进", 502, "SCHEMA_INVALID");
    seen.add(Number(candidate.questionId));
    const safe = candidate.safeSuggestions, sensitive = candidate.sensitiveSuggestions, confidence = candidate.confidence, reasons = candidate.reasons;
    if (!isObject(safe) || !isObject(sensitive) || !isObject(confidence) || !isObject(reasons)) throw new AiServiceError("AI 审核建议字段类型无效，当前批次未推进", 502, "SCHEMA_INVALID");
    for (const [group, allowed] of [[safe, SAFE_QUESTION_FIELDS], [sensitive, SENSITIVE_QUESTION_FIELDS]] as const) for (const [field, suggestion] of Object.entries(group)) {
      if (!allowed.includes(field as never) || typeof suggestion !== "string" || !suggestion.trim()) throw new AiServiceError("AI 审核包含无效字段或空建议，当前批次未推进", 502, "SCHEMA_INVALID");
      if (!Object.hasOwn(confidence, field) || !Number.isFinite(Number(confidence[field])) || Number(confidence[field]) < 0 || Number(confidence[field]) > 1) throw new AiServiceError("AI 审核置信度缺失或超出范围，当前批次未推进", 502, "SCHEMA_INVALID");
      if (typeof reasons[field] !== "string" || !String(reasons[field]).trim()) throw new AiServiceError("AI 审核理由缺失，当前批次未推进", 502, "SCHEMA_INVALID");
    }
    if (Object.keys(confidence).some((field) => !allFields.includes(field)) || Object.keys(reasons).some((field) => !allFields.includes(field))) throw new AiServiceError("AI 审核包含未知字段，当前批次未推进", 502, "SCHEMA_INVALID");
    reviews.push({ questionId: Number(candidate.questionId), safeSuggestions: safe, sensitiveSuggestions: sensitive, confidence: confidence as Record<string, number>, reasons: reasons as Record<string, string> });
  }
  return { reviews };
}

async function list(accessId: number) {
  await env.DB.prepare("UPDATE ai_question_reviews SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT r.id FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id JOIN questions q ON q.id=r.question_id WHERE ar.user_id=? AND r.status IN ('pending','partially_applied') AND q.updated_at<>r.source_updated_at)").bind(accessId).run();
  const [rows, tasks] = await Promise.all([
    env.DB.prepare("SELECT r.id,r.task_id AS taskId,r.question_id AS questionId,r.source_updated_at AS sourceUpdatedAt,r.current_values_json AS currentValuesJson,r.safe_suggestions_json AS safeSuggestionsJson,r.sensitive_suggestions_json AS sensitiveSuggestionsJson,r.confidence_json AS confidenceJson,r.reasons_json AS reasonsJson,r.eligible_fields_json AS eligibleFieldsJson,r.status,r.applied_fields_json AS appliedFieldsJson,r.created_at AS createdAt,q.stem FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id JOIN questions q ON q.id=r.question_id WHERE ar.user_id=? AND r.status IN ('pending','partially_applied') ORDER BY r.created_at DESC LIMIT 100").bind(accessId).all<Record<string, any>>(),
    env.DB.prepare("SELECT id,mode,cursor,total,processed,status,last_error AS lastError,created_at AS createdAt,updated_at AS updatedAt FROM ai_question_review_tasks WHERE user_id=? ORDER BY updated_at DESC LIMIT 20").bind(accessId).all<Record<string, any>>(),
  ]);
  return { reviews: rows.results.map((row) => ({ ...row, currentValues: JSON.parse(row.currentValuesJson || "{}"), safeSuggestions: JSON.parse(row.safeSuggestionsJson || "{}"), sensitiveSuggestions: JSON.parse(row.sensitiveSuggestionsJson || "{}"), confidence: JSON.parse(row.confidenceJson || "{}"), reasons: JSON.parse(row.reasonsJson || "{}"), eligibleFields: JSON.parse(row.eligibleFieldsJson || "[]"), appliedFields: JSON.parse(row.appliedFieldsJson || "[]") })), tasks: tasks.results };
}

export async function GET() { const access = await requirePermission("questions:read"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied; return Response.json(await list(access.id), { headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  let taskId = "";
  try {
    const body = await request.json() as { questionIds?: unknown[]; taskId?: string; deepReview?: boolean };
    if (body.taskId) taskId = String(body.taskId);
    else {
      const ids = [...new Set((body.questionIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
      if (!ids.length || ids.length > 100) return Response.json({ error: "一次 AI 审核任务必须选择 1—100 道题" }, { status: 400 });
      if (body.deepReview && ids.length !== 1) return Response.json({ error: "DeepSeek Pro 深度复核必须逐题触发" }, { status: 400 });
      taskId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO ai_question_review_tasks(id,user_id,question_ids_json,mode,total) VALUES(?,?,?,?,?)").bind(taskId, access.id, JSON.stringify(ids), body.deepReview ? "deep" : "batch", ids.length).run();
      await audit(access, "create", "ai_question_review_task", taskId, { total: ids.length, mode: body.deepReview ? "deep" : "batch" });
    }
    const task = await env.DB.prepare("SELECT id,user_id AS userId,question_ids_json AS questionIdsJson,mode,cursor,total,processed,status FROM ai_question_review_tasks WHERE id=?").bind(taskId).first<Record<string, any>>();
    if (!task || Number(task.userId) !== access.id) return Response.json({ error: "审核任务不存在或无权继续" }, { status: 404 });
    const ids = JSON.parse(task.questionIdsJson || "[]") as number[], cursor = Number(task.cursor || 0);
    if (cursor >= ids.length) { await env.DB.prepare("UPDATE ai_question_review_tasks SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(taskId, access.id).run(); return Response.json({ ...(await list(access.id)), task: { ...task, status: "completed" }, processed: 0 }); }
    const batchIds = ids.slice(cursor, cursor + 10), placeholders = batchIds.map(() => "?").join(",");
    const claimed = await env.DB.prepare("UPDATE ai_question_review_tasks SET status='running',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND cursor=? AND (status IN ('queued','failed') OR (status='running' AND datetime(updated_at)<datetime('now','-3 minutes'))) RETURNING id").bind(taskId, access.id, cursor).first<{ id: string }>();
    if (!claimed) throw new AiServiceError("该审核任务正在另一个页面处理中，请稍后刷新", 409, "TASK_BUSY");
    const rows = await env.DB.prepare(`SELECT id,stem,material,options,answer,analysis,fact_basis AS factBasis,textbook_view AS textbookView,value_judgment AS valueJudgment,answer_logic AS answerLogic,standard_expression AS standardExpression,question_type AS questionType,stage,grade,textbook_version AS textbookVersion,volume,unit,topic,knowledge_points AS knowledgePoints,core_competencies AS coreCompetencies,ability_level AS abilityLevel,updated_at AS updatedAt FROM questions WHERE id IN (${placeholders})`).bind(...batchIds).all<Record<string, any>>();
    if (rows.results.length !== batchIds.length) throw new AiServiceError("部分题目已不存在，审核任务暂停", 409, "QUESTION_MISSING");
    const vocab: Record<string, string[]> = {};
    for (const [field, column] of Object.entries(fieldColumns)) { const result = await env.DB.prepare(`SELECT DISTINCT ${column} AS value FROM questions WHERE ${column} IS NOT NULL AND TRIM(${column})<>'' ORDER BY updated_at DESC LIMIT 100`).all<{ value: string }>(); vocab[field] = result.results.map((item) => String(item.value)); }
    const validate = (value: unknown) => validateReviewBatch(value, batchIds);
    const payload = { instruction: "审核政治学科题目并严格输出 JSON。安全分类字段只能建议 vocabulary 中的已有值；不确定则不建议。答案、解析、事实依据、教材观点、价值判断、答题逻辑、规范表述只给逐题建议。每个字段给 0 到 1 置信度和简短理由；不得声称已核验政策时效。", safeFields: SAFE_QUESTION_FIELDS, sensitiveFields: SENSITIVE_QUESTION_FIELDS, vocabulary: vocab, questions: rows.results, requiredJsonExample: { reviews: [{ questionId: 1, safeSuggestions: {}, sensitiveSuggestions: {}, confidence: {}, reasons: {} }] } };
    const deep = task.mode === "deep", result = await callDeepSeekJson<{ reviews: ReviewResult[] }>({ access, feature: "question_review", entityType: deep ? "question_deep_review" : "question_batch", entityId: taskId, system: "你是教师题库的辅助审核员。仅输出 JSON。不得修改题目，不得绕过教师人工复核，不得编造事实或教材观点。", payload, thinking: true, useProModel: deep, maxTokens: deep ? 4200 : 5000, validate });
    const byId = new Map(rows.results.map((row) => [Number(row.id), row]));
    for (const review of result.data.reviews) {
      const source = byId.get(Number(review.questionId)); if (!source) continue;
      const safe = Object.fromEntries(Object.entries(review.safeSuggestions || {}).filter(([key, value]) => SAFE_QUESTION_FIELDS.includes(key as any) && typeof value === "string"));
      const sensitive = Object.fromEntries(Object.entries(review.sensitiveSuggestions || {}).filter(([key, value]) => SENSITIVE_QUESTION_FIELDS.includes(key as any) && typeof value === "string"));
      const confidence = Object.fromEntries(Object.entries(review.confidence || {}).filter(([key, value]) => [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS].includes(key as any) && Number.isFinite(Number(value))).map(([key, value]) => [key, Math.max(0, Math.min(1, Number(value)))]));
      const reasons = Object.fromEntries(Object.entries(review.reasons || {}).filter(([key]) => [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS].includes(key as any)).map(([key, value]) => [key, String(value).slice(0, 400)]));
      if (!Object.keys(safe).length && !Object.keys(sensitive).length) continue;
      const currentValues = Object.fromEntries([...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS].map((key) => [key, source[key] == null ? "" : String(source[key])]));
      const eligibleFields = Object.entries(safe).filter(([field, value]) => Number(confidence[field] || 0) >= 0.85 && (vocab[field] || []).includes(String(value))).map(([field]) => field);
      await env.DB.prepare("INSERT INTO ai_question_reviews(run_id,task_id,question_id,source_updated_at,current_values_json,safe_suggestions_json,sensitive_suggestions_json,confidence_json,reasons_json,eligible_fields_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(question_id,source_updated_at) DO UPDATE SET run_id=excluded.run_id,task_id=excluded.task_id,current_values_json=excluded.current_values_json,safe_suggestions_json=excluded.safe_suggestions_json,sensitive_suggestions_json=excluded.sensitive_suggestions_json,confidence_json=excluded.confidence_json,reasons_json=excluded.reasons_json,eligible_fields_json=excluded.eligible_fields_json,status='pending',applied_fields_json='[]',updated_at=CURRENT_TIMESTAMP").bind(result.runId, taskId, source.id, source.updatedAt, JSON.stringify(currentValues), JSON.stringify(safe), JSON.stringify(sensitive), JSON.stringify(confidence), JSON.stringify(reasons), JSON.stringify(eligibleFields)).run();
    }
    const nextCursor = cursor + batchIds.length, completed = nextCursor >= ids.length;
    const advanced = await env.DB.prepare("UPDATE ai_question_review_tasks SET cursor=?,processed=processed+?,status=?,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND cursor=? AND status='running'").bind(nextCursor, batchIds.length, completed ? "completed" : "queued", taskId, access.id, cursor).run();
    if (!Number(advanced.meta?.changes || 0)) throw new AiServiceError("审核任务状态已变化，当前结果未推进", 409, "TASK_STATE_CHANGED");
    await audit(access, "generate", "ai_question_review_task", taskId, { runId: result.runId, model: result.model, batch: batchIds.length, cursor: nextCursor, total: ids.length });
    return Response.json({ ...(await list(access.id)), task: { id: taskId, mode: task.mode, cursor: nextCursor, total: ids.length, processed: Number(task.processed || 0) + batchIds.length, status: completed ? "completed" : "queued" }, processed: batchIds.length, notice: "建议已保存到待确认队列，题库原数据未改变。" });
  } catch (error) { if (taskId) { if (!(error instanceof AiServiceError && error.code === "TASK_BUSY")) await env.DB.prepare("UPDATE ai_question_review_tasks SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(error instanceof Error ? error.message.slice(0, 500) : "未知错误", taskId, access.id).run(); await audit(access, "generate_failed", "ai_question_review_task", taskId, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); } return aiErrorResponse(error); }
}
