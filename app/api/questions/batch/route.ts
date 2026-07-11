import { inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { questions } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { ids?: number[]; action?: string; value?: string }, ids = [...new Set((body.ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))].slice(0, 100);
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
  else if (action === "status") updates.status = body.value === "review" ? "review" : "active";
  else return Response.json({ error: "不支持的批量操作" }, { status: 400 });
  await getDb().update(questions).set(updates).where(inArray(questions.id, ids));
  await audit(access, "batch_update", "question", ids.join(","), { action, count: ids.length });
  return Response.json({ ok: true, count: ids.length });
}
