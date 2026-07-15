import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";
import { aiErrorResponse, callDeepSeekJson, requireAiTeacher, SAFE_QUESTION_FIELDS, SENSITIVE_QUESTION_FIELDS } from "../../../lib/ai/server";

const fieldColumns: Record<string, string> = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level" };
type ReviewResult = { questionId: number; safeSuggestions?: Record<string, unknown>; sensitiveSuggestions?: Record<string, unknown>; confidence?: Record<string, number>; reasons?: Record<string, string> };

async function list(accessId: number) {
  const rows = await env.DB.prepare("SELECT r.id,r.question_id AS questionId,r.source_updated_at AS sourceUpdatedAt,r.safe_suggestions_json AS safeSuggestionsJson,r.sensitive_suggestions_json AS sensitiveSuggestionsJson,r.confidence_json AS confidenceJson,r.reasons_json AS reasonsJson,r.status,r.applied_fields_json AS appliedFieldsJson,r.created_at AS createdAt,q.stem FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id JOIN questions q ON q.id=r.question_id WHERE ar.user_id=? AND r.status IN ('pending','partially_applied') ORDER BY r.created_at DESC LIMIT 100").bind(accessId).all<Record<string, any>>();
  return rows.results.map((row) => ({ ...row, safeSuggestions: JSON.parse(row.safeSuggestionsJson || "{}"), sensitiveSuggestions: JSON.parse(row.sensitiveSuggestionsJson || "{}"), confidence: JSON.parse(row.confidenceJson || "{}"), reasons: JSON.parse(row.reasonsJson || "{}"), appliedFields: JSON.parse(row.appliedFieldsJson || "[]") }));
}

export async function GET() { const access = await requirePermission("questions:read"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied; return Response.json({ reviews: await list(access.id) }); }

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  try {
    const body = await request.json() as { questionIds?: unknown[] }, ids = [...new Set((body.questionIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 10);
    if (!ids.length) return Response.json({ error: "请选择 1—10 道题进行 AI 审核" }, { status: 400 });
    const placeholders = ids.map(() => "?").join(","), rows = await env.DB.prepare(`SELECT id,stem,material,options,answer,analysis,fact_basis AS factBasis,textbook_view AS textbookView,value_judgment AS valueJudgment,answer_logic AS answerLogic,standard_expression AS standardExpression,question_type AS questionType,stage,grade,textbook_version AS textbookVersion,volume,unit,topic,knowledge_points AS knowledgePoints,core_competencies AS coreCompetencies,ability_level AS abilityLevel,updated_at AS updatedAt FROM questions WHERE id IN (${placeholders})`).bind(...ids).all<Record<string, any>>();
    const vocab: Record<string, string[]> = {};
    for (const [field, column] of Object.entries(fieldColumns)) { const result = await env.DB.prepare(`SELECT DISTINCT ${column} AS value FROM questions WHERE ${column} IS NOT NULL AND TRIM(${column})<>'' ORDER BY updated_at DESC LIMIT 100`).all<{ value: string }>(); vocab[field] = result.results.map((item) => String(item.value)); }
    const payload = { instruction: "审核政治学科题目并输出 JSON。安全分类字段只能建议 vocabulary 中的已有值；不确定则不建议。答案、解析、事实依据、教材观点、价值判断、答题逻辑、规范表述属于敏感字段，只给逐题建议，不得声称已核验政策时效。每个字段给 0 到 1 置信度和简短理由。", safeFields: SAFE_QUESTION_FIELDS, sensitiveFields: SENSITIVE_QUESTION_FIELDS, vocabulary: vocab, questions: rows.results, requiredShape: { reviews: [{ questionId: 1, safeSuggestions: {}, sensitiveSuggestions: {}, confidence: {}, reasons: {} }] } };
    const result = await callDeepSeekJson<{ reviews?: ReviewResult[] }>({ access, feature: "question_review", entityType: "question_batch", entityId: ids.join(","), system: "你是教师题库的辅助审核员。仅输出 JSON 对象。不得修改题目，不得绕过教师人工复核，不得编造事实或教材观点。", payload, deep: true, maxTokens: 5000 });
    const byId = new Map(rows.results.map((row) => [Number(row.id), row]));
    for (const review of Array.isArray(result.data?.reviews) ? result.data.reviews : []) {
      const source = byId.get(Number(review.questionId)); if (!source) continue;
      const safe = Object.fromEntries(Object.entries(review.safeSuggestions || {}).filter(([key, value]) => SAFE_QUESTION_FIELDS.includes(key as any) && typeof value === "string"));
      const sensitive = Object.fromEntries(Object.entries(review.sensitiveSuggestions || {}).filter(([key, value]) => SENSITIVE_QUESTION_FIELDS.includes(key as any) && typeof value === "string"));
      const confidence = Object.fromEntries(Object.entries(review.confidence || {}).filter(([key, value]) => [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS].includes(key as any) && Number.isFinite(Number(value))).map(([key, value]) => [key, Math.max(0, Math.min(1, Number(value)))]));
      const reasons = Object.fromEntries(Object.entries(review.reasons || {}).filter(([key]) => [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS].includes(key as any)).map(([key, value]) => [key, String(value).slice(0, 400)]));
      await env.DB.prepare("INSERT OR IGNORE INTO ai_question_reviews(run_id,question_id,source_updated_at,safe_suggestions_json,sensitive_suggestions_json,confidence_json,reasons_json) VALUES(?,?,?,?,?,?,?)").bind(result.runId, source.id, source.updatedAt, JSON.stringify(safe), JSON.stringify(sensitive), JSON.stringify(confidence), JSON.stringify(reasons)).run();
    }
    return Response.json({ reviews: await list(access.id), processed: rows.results.length, notice: "建议已保存到待确认队列，题库原数据未改变。" });
  } catch (error) { return aiErrorResponse(error); }
}
