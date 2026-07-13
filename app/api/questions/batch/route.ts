import { inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { questions, questionSets } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionReadinessIssues } from "../../../lib/question-readiness";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { ids?: number[]; action?: string; value?: string }, ids = [...new Set((body.ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))].slice(0, 300);
  if (!ids.length) return Response.json({ error: "请至少选择一道题目" }, { status: 400 });
  const action = String(body.action || ""), updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (action === "delete") {
    const marks = ids.map(() => "?").join(","), references = await env.DB.prepare(`SELECT q.id,MAX(CASE WHEN pq.id IS NOT NULL THEN 1 ELSE 0 END) AS paperRef,MAX(CASE WHEN lq.id IS NOT NULL THEN 1 ELSE 0 END) AS lessonRef FROM questions q LEFT JOIN paper_questions pq ON pq.question_id=q.id LEFT JOIN lesson_questions lq ON lq.question_id=q.id WHERE q.id IN (${marks}) GROUP BY q.id HAVING paperRef=1 OR lessonRef=1`).bind(...ids).all<Record<string, unknown>>();
    if (references.results.length) return Response.json({ error: "所选题目中有已被试卷或课时引用的题目，不能批量删除", references: references.results }, { status: 409 });
    await getDb().delete(questions).where(inArray(questions.id, ids));
    await audit(access, "batch_delete", "question", ids.join(","), { count: ids.length });
    return Response.json({ ok: true, count: ids.length, deleted: true });
  }
  if (action === "tags") updates.tags = String(body.value || "").trim();
  else if (action === "knowledge") updates.knowledgePoints = String(body.value || "").trim();
  else if (["stage", "grade", "questionType", "textbookVersion", "volume", "unit", "topic"].includes(action)) updates[action] = action === "questionType" ? String(body.value || "单选题") : String(body.value || "").trim();
  else if (action === "difficulty") updates.difficulty = Math.max(1, Math.min(5, Number(body.value || 3)));
  else if (action === "ignore") { updates.reviewStatus = "ignored"; updates.status = "review"; }
  else if (action === "return") { updates.reviewStatus = "returned"; updates.reviewed = false; updates.status = "review"; }
  else if (action === "confirm") {
    const selected = await getDb().select().from(questions).where(inArray(questions.id, ids));
    const fingerprints = selected.map((item) => item.fingerprint).filter(Boolean) as string[], duplicateIds = new Set<number>();
    if (fingerprints.length) { const marks = fingerprints.map(() => "?").join(","), duplicates = await env.DB.prepare(`SELECT id FROM questions WHERE fingerprint IN (${marks}) AND fingerprint IN (SELECT fingerprint FROM questions WHERE fingerprint IN (${marks}) GROUP BY fingerprint HAVING COUNT(*)>1)`).bind(...fingerprints, ...fingerprints).all<{ id: number }>(); duplicates.results.forEach((item) => duplicateIds.add(item.id)); }
    const blocked = selected.map((item) => ({ id: item.id, issues: questionReadinessIssues(item, { duplicate: duplicateIds.has(item.id) }) })).filter((item) => item.issues.length);
    if (blocked.length) return Response.json({ error: `有 ${blocked.length} 道题仍需人工确认，未执行批量入库`, blocked, report: { selected: ids.length, ready: ids.length - blocked.length, blocked: blocked.length } }, { status: 409 });
    updates.status = "active"; updates.reviewed = true; updates.reviewStatus = "confirmed";
  }
  else if (action === "status" && body.value === "review") { updates.status = "review"; updates.reviewStatus = "pending"; }
  else return Response.json({ error: "不支持的批量操作" }, { status: 400 });
  await getDb().update(questions).set(updates).where(inArray(questions.id, ids));
  const sets = await getDb().select({ id: questions.questionSetId }).from(questions).where(inArray(questions.id, ids));
  for (const setId of [...new Set(sets.map((item) => item.id).filter(Boolean))] as number[]) {
    const [{ count = 0 } = { count: 0 }] = await env.DB.prepare("SELECT COUNT(*) AS count FROM questions WHERE question_set_id=? AND reviewed=1").bind(setId).all<Record<string, number>>().then((result) => result.results);
    await getDb().update(questionSets).set({ reviewProgress: Number(count), updatedAt: new Date().toISOString() }).where(inArray(questionSets.id, [setId]));
  }
  await audit(access, "batch_update", "question", ids.join(","), { action, count: ids.length });
  return Response.json({ ok: true, count: ids.length });
}
