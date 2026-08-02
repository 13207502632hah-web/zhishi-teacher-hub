import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { requireAiTeacher, SAFE_QUESTION_FIELDS, SENSITIVE_QUESTION_FIELDS } from "../../../../lib/ai/server";

const columns: Record<string, string> = { questionType: "question_type", stage: "stage", grade: "grade", textbookVersion: "textbook_version", volume: "volume", unit: "unit", topic: "topic", knowledgePoints: "knowledge_points", coreCompetencies: "core_competencies", abilityLevel: "ability_level", answer: "answer", analysis: "analysis", factBasis: "fact_basis", textbookView: "textbook_view", valueJudgment: "value_judgment", answerLogic: "answer_logic", standardExpression: "standard_expression" };

async function markReviewStale(reviewId: number, userId: number, runId: number, status: string, sourceUpdatedAt: string) {
  return env.DB.prepare("UPDATE ai_question_reviews SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=? AND run_id=? AND status=? AND source_updated_at=? AND EXISTS(SELECT 1 FROM ai_runs ar WHERE ar.id=ai_question_reviews.run_id AND ar.user_id=?) AND NOT EXISTS(SELECT 1 FROM questions q WHERE q.id=ai_question_reviews.question_id AND q.updated_at=ai_question_reviews.source_updated_at) RETURNING id")
    .bind(reviewId, runId, status, sourceUpdatedAt, userId).first<{ id: number }>();
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const body = await request.json() as { reviewIds?: unknown[]; mode?: string; fields?: string[]; action?: string }, ids = [...new Set((body.reviewIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100), mode = body.mode === "single" ? "single" : "batch";
  if (!ids.length) return Response.json({ error: "没有可处理的审核建议" }, { status: 400 });
  if (mode === "single" && ids.length !== 1) return Response.json({ error: "新术语、低置信度和敏感建议必须逐题确认" }, { status: 400 });
  if (mode === "single" && (!Array.isArray(body.fields) || !body.fields.length)) return Response.json({ error: "逐题处理必须明确勾选要应用的字段" }, { status: 400 });
  const skipped: number[] = [];
  if (body.action === "reject") {
    let rejected = 0;
    for (const id of ids) {
      const expected = await env.DB.prepare("SELECT r.run_id AS runId,r.status,r.source_updated_at AS sourceUpdatedAt FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=? AND ar.user_id=?").bind(id, access.id).first<{ runId: number; status: string; sourceUpdatedAt: string }>();
      if (!expected || !["pending", "partially_applied"].includes(expected.status)) { skipped.push(id); continue; }
      const rejectedReview = await env.DB.prepare("UPDATE ai_question_reviews SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND run_id=? AND status=? AND source_updated_at=? AND EXISTS(SELECT 1 FROM ai_runs ar WHERE ar.id=ai_question_reviews.run_id AND ar.user_id=?) RETURNING id,question_id AS questionId").bind(id, expected.runId, expected.status, expected.sourceUpdatedAt, access.id).first<{ id: number; questionId: number }>();
      if (!rejectedReview) { skipped.push(id); continue; }
      await audit(access, "reject", "ai_question_review", id);
      rejected += 1;
    }
    return Response.json({ ok: true, rejected, skipped });
  }
  const applied: Array<{ reviewId: number; questionId: number; changes: Array<{ field: string; before: string; after: string }> }> = [], stale: number[] = [];
  for (const reviewId of ids) {
    const review = await env.DB.prepare("SELECT r.*,ar.user_id AS userId FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=?").bind(reviewId).first<Record<string, any>>();
    if (!review || Number(review.userId) !== access.id || !["pending", "partially_applied"].includes(String(review.status))) { skipped.push(reviewId); continue; }
    const expectedRunId = Number(review.run_id), expectedStatus = String(review.status), expectedSourceUpdatedAt = String(review.source_updated_at);
    const question = await env.DB.prepare("SELECT updated_at AS updatedAt FROM questions WHERE id=?").bind(review.question_id).first<{ updatedAt: string }>();
    if (!question || question.updatedAt !== expectedSourceUpdatedAt) { const staleResult = await markReviewStale(reviewId, access.id, expectedRunId, expectedStatus, expectedSourceUpdatedAt); if (staleResult) stale.push(reviewId); else skipped.push(reviewId); continue; }
    const currentValues = JSON.parse(review.current_values_json || "{}") as Record<string, string>, safe = JSON.parse(review.safe_suggestions_json || "{}") as Record<string, string>, sensitive = JSON.parse(review.sensitive_suggestions_json || "{}") as Record<string, string>, eligible = new Set<string>(JSON.parse(review.eligible_fields_json || "[]")), previousApplied = new Set<string>(JSON.parse(review.applied_fields_json || "[]"));
    const source = mode === "single" ? { ...safe, ...sensitive } : safe, requested = new Set(mode === "single" ? body.fields : [...eligible]), allowed = mode === "single" ? [...SAFE_QUESTION_FIELDS, ...SENSITIVE_QUESTION_FIELDS] : [...SAFE_QUESTION_FIELDS], chosen: Array<[string, string]> = [];
    for (const [field, value] of Object.entries(source)) { if (!requested.has(field) || !allowed.includes(field as any) || previousApplied.has(field) || !String(value).trim()) continue; if (mode === "batch" && !eligible.has(field)) continue; chosen.push([field, String(value).slice(0, 12000)]); }
    if (!chosen.length) { skipped.push(reviewId); continue; }
    const nextUpdatedAt = new Date().toISOString(), allApplied = new Set([...previousApplied, ...chosen.map(([field]) => field)]), allSuggestions = Object.keys({ ...safe, ...sensitive }), status = allSuggestions.every((field) => allApplied.has(field)) ? "applied" : "partially_applied", nextCurrent = { ...currentValues, ...Object.fromEntries(chosen) };
    const setSql = chosen.map(([field]) => `${columns[field]}=?`).join(","), questionUpdate = env.DB.prepare(`UPDATE questions SET ${setSql},updated_at=? WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.id=? AND r.question_id=questions.id AND r.run_id=? AND r.status=? AND r.source_updated_at=? AND ar.user_id=?)`).bind(...chosen.map(([, value]) => value), nextUpdatedAt, review.question_id, expectedSourceUpdatedAt, reviewId, expectedRunId, expectedStatus, expectedSourceUpdatedAt, access.id), reviewUpdate = env.DB.prepare("UPDATE ai_question_reviews SET source_updated_at=?,current_values_json=?,status=?,applied_fields_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND question_id=? AND run_id=? AND status=? AND source_updated_at=? AND EXISTS(SELECT 1 FROM ai_runs ar WHERE ar.id=ai_question_reviews.run_id AND ar.user_id=?) AND EXISTS(SELECT 1 FROM questions q WHERE q.id=ai_question_reviews.question_id AND q.updated_at=?)").bind(nextUpdatedAt, JSON.stringify(nextCurrent), status, JSON.stringify([...allApplied]), reviewId, review.question_id, expectedRunId, expectedStatus, expectedSourceUpdatedAt, access.id, nextUpdatedAt);
    const [questionResult, reviewResult] = await env.DB.batch([questionUpdate, reviewUpdate]);
    const questionChanges = Number(questionResult.meta?.changes || 0), reviewChanges = Number(reviewResult.meta?.changes || 0);
    if (questionChanges !== reviewChanges) throw new Error("AI 审核建议的题目与状态更新不一致，请重新读取后再试");
    if (!questionChanges) { const staleResult = await markReviewStale(reviewId, access.id, expectedRunId, expectedStatus, expectedSourceUpdatedAt); if (staleResult) stale.push(reviewId); else skipped.push(reviewId); continue; }
    const changes = chosen.map(([field, after]) => ({ field, before: String(currentValues[field] || ""), after }));
    await audit(access, "apply_ai_suggestion", "question", review.question_id, { reviewId, mode, changes, preservesFormalReview: true });
    applied.push({ reviewId, questionId: Number(review.question_id), changes });
  }
  return Response.json({ applied, stale, skipped, notice: "仅更新教师明确确认的字段；题目正式状态与人工复核标记保持不变。" });
}
