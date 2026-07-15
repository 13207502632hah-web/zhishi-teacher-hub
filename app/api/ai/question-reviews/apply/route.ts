import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { requireAiTeacher, SAFE_QUESTION_FIELDS, SENSITIVE_QUESTION_FIELDS } from "../../../../lib/ai/server";

const columns: Record<string, string> = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level", answer: "answer", analysis: "analysis", factBasis: "fact_basis", textbookView: "textbook_view", valueJudgment: "value_judgment", answerLogic: "answer_logic", standardExpression: "standard_expression" };

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const body = await request.json() as { reviewIds?: unknown[]; mode?: string; fields?: string[]; action?: string }, ids = [...new Set((body.reviewIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100), mode = body.mode === "single" ? "single" : "batch";
  if (!ids.length) return Response.json({ error: "没有可应用的审核建议" }, { status: 400 });
  if (mode === "single" && ids.length !== 1) return Response.json({ error: "敏感建议必须逐题确认" }, { status: 400 });
  if (body.action === "reject") { for (const id of ids) await env.DB.prepare("UPDATE ai_question_reviews SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run(); await audit(access, "reject", "ai_question_reviews", ids.join(",")); return Response.json({ ok: true, rejected: ids.length }); }
  const applied: Array<{ reviewId: number; questionId: number; fields: string[] }> = [], stale: number[] = [];
  for (const reviewId of ids) {
    const review = await env.DB.prepare("SELECT r.*,ar.user_id AS userId FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=?").bind(reviewId).first<Record<string, any>>();
    if (!review || Number(review.userId) !== access.id || !["pending", "partially_applied"].includes(String(review.status))) continue;
    const question = await env.DB.prepare("SELECT updated_at AS updatedAt FROM questions WHERE id=?").bind(review.question_id).first<{ updatedAt: string }>();
    if (!question || question.updatedAt !== review.source_updated_at) { stale.push(reviewId); await env.DB.prepare("UPDATE ai_question_reviews SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reviewId).run(); continue; }
    const safe = JSON.parse(review.safe_suggestions_json || "{}") as Record<string, string>, sensitive = JSON.parse(review.sensitive_suggestions_json || "{}") as Record<string, string>, confidence = JSON.parse(review.confidence_json || "{}") as Record<string, number>;
    const source = mode === "single" ? { ...safe, ...sensitive } : safe, requested = new Set(body.fields || Object.keys(source)), allowed = mode === "single" ? [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS] : [...SAFE_QUESTION_FIELDS], chosen: Array<[string, string]> = [];
    for (const [field, value] of Object.entries(source)) {
      if (!requested.has(field) || !allowed.includes(field as any) || !String(value).trim()) continue;
      if (mode === "batch") {
        if (Number(confidence[field] || 0) < 0.85) continue;
        const column = columns[field], exists = await env.DB.prepare(`SELECT 1 AS found FROM questions WHERE ${column}=? LIMIT 1`).bind(value).first();
        if (!exists) continue;
      }
      chosen.push([field, String(value).slice(0, 12000)]);
    }
    if (!chosen.length) continue;
    for (const [field, value] of chosen) await env.DB.prepare(`UPDATE questions SET ${columns[field]}=? WHERE id=?`).bind(value, review.question_id).run();
    await env.DB.prepare("UPDATE questions SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(review.question_id).run();
    const sensitiveApplied = chosen.some(([field]) => SENSITIVE_QUESTION_FIELDS.includes(field as any)), status = sensitiveApplied || Object.keys(sensitive).length === 0 ? "applied" : "partially_applied";
    await env.DB.prepare("UPDATE ai_question_reviews SET status=?,applied_fields_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, JSON.stringify(chosen.map(([field]) => field)), reviewId).run();
    await audit(access, "apply_ai_suggestion", "question", review.question_id, { reviewId, mode, fields: chosen.map(([field]) => field), preservesFormalReview: true });
    applied.push({ reviewId, questionId: Number(review.question_id), fields: chosen.map(([field]) => field) });
  }
  return Response.json({ applied, stale, notice: "仅更新已确认字段；题目正式状态与人工复核标记保持不变。" });
}
