import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { requireAiTeacher, SAFE_QUESTION_FIELDS, SENSITIVE_QUESTION_FIELDS } from "../../../../lib/ai/server";

const columns: Record<string, string> = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level", answer: "answer", analysis: "analysis", factBasis: "fact_basis", textbookView: "textbook_view", valueJudgment: "value_judgment", answerLogic: "answer_logic", standardExpression: "standard_expression" };

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const body = await request.json() as { reviewIds?: unknown[]; mode?: string; fields?: string[]; action?: string }, ids = [...new Set((body.reviewIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100), mode = body.mode === "single" ? "single" : "batch";
  if (!ids.length) return Response.json({ error: "没有可处理的审核建议" }, { status: 400 });
  if (mode === "single" && ids.length !== 1) return Response.json({ error: "新术语、低置信度和敏感建议必须逐题确认" }, { status: 400 });
  if (mode === "single" && (!Array.isArray(body.fields) || !body.fields.length)) return Response.json({ error: "逐题处理必须明确勾选要应用的字段" }, { status: 400 });
  if (body.action === "reject") {
    let rejected = 0;
    for (const id of ids) { const owned = await env.DB.prepare("SELECT 1 AS owned FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=? AND ar.user_id=?").bind(id, access.id).first(); if (!owned) continue; await env.DB.prepare("UPDATE ai_question_reviews SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run(); await audit(access, "reject", "ai_question_review", id); rejected += 1; }
    return Response.json({ ok: true, rejected });
  }
  const applied: Array<{ reviewId: number; questionId: number; changes: Array<{ field: string; before: string; after: string }> }> = [], stale: number[] = [];
  for (const reviewId of ids) {
    const review = await env.DB.prepare("SELECT r.*,ar.user_id AS userId FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=?").bind(reviewId).first<Record<string, any>>();
    if (!review || Number(review.userId) !== access.id || !["pending", "partially_applied"].includes(String(review.status))) continue;
    const question = await env.DB.prepare("SELECT updated_at AS updatedAt FROM questions WHERE id=?").bind(review.question_id).first<{ updatedAt: string }>();
    if (!question || question.updatedAt !== review.source_updated_at) { stale.push(reviewId); await env.DB.prepare("UPDATE ai_question_reviews SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reviewId).run(); continue; }
    const currentValues = JSON.parse(review.current_values_json || "{}") as Record<string, string>, safe = JSON.parse(review.safe_suggestions_json || "{}") as Record<string, string>, sensitive = JSON.parse(review.sensitive_suggestions_json || "{}") as Record<string, string>, eligible = new Set<string>(JSON.parse(review.eligible_fields_json || "[]")), previousApplied = new Set<string>(JSON.parse(review.applied_fields_json || "[]"));
    const source = mode === "single" ? { ...safe, ...sensitive } : safe, requested = new Set(mode === "single" ? body.fields : [...eligible]), allowed = mode === "single" ? [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS] : [...SAFE_QUESTION_FIELDS], chosen: Array<[string, string]> = [];
    for (const [field, value] of Object.entries(source)) { if (!requested.has(field) || !allowed.includes(field as any) || previousApplied.has(field) || !String(value).trim()) continue; if (mode === "batch" && !eligible.has(field)) continue; chosen.push([field, String(value).slice(0, 12000)]); }
    if (!chosen.length) continue;
    const nextUpdatedAt = new Date().toISOString(), allApplied = new Set([...previousApplied, ...chosen.map(([field]) => field)]), allSuggestions = Object.keys({ ...safe, ...sensitive }), status = allSuggestions.every((field) => allApplied.has(field)) ? "applied" : "partially_applied", nextCurrent = { ...currentValues, ...Object.fromEntries(chosen) };
    const setSql = chosen.map(([field]) => `${columns[field]}=?`).join(","), questionUpdate = env.DB.prepare(`UPDATE questions SET ${setSql},updated_at=? WHERE id=? AND updated_at=?`).bind(...chosen.map(([, value]) => value), nextUpdatedAt, review.question_id, review.source_updated_at), reviewUpdate = env.DB.prepare("UPDATE ai_question_reviews SET source_updated_at=?,current_values_json=?,status=?,applied_fields_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM questions WHERE id=? AND updated_at=?)").bind(nextUpdatedAt, JSON.stringify(nextCurrent), status, JSON.stringify([...allApplied]), reviewId, review.question_id, nextUpdatedAt);
    const [questionResult] = await env.DB.batch([questionUpdate, reviewUpdate]);
    if (!Number(questionResult.meta?.changes || 0)) { stale.push(reviewId); await env.DB.prepare("UPDATE ai_question_reviews SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reviewId).run(); continue; }
    const changes = chosen.map(([field, after]) => ({ field, before: String(currentValues[field] || ""), after }));
    await audit(access, "apply_ai_suggestion", "question", review.question_id, { reviewId, mode, changes, preservesFormalReview: true });
    applied.push({ reviewId, questionId: Number(review.question_id), changes });
  }
  return Response.json({ applied, stale, notice: "仅更新教师明确确认的字段；题目正式状态与人工复核标记保持不变。" });
}
