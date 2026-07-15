import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { reviewQuestions } from "../../../../lib/services/question-review-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  const set = await env.DB.prepare("SELECT id FROM question_sets WHERE id=?").bind(id).first();
  if (!set) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const all = (await env.DB.prepare("SELECT id,reviewed FROM questions WHERE question_set_id=? ORDER BY id").bind(id).all<{ id: number; reviewed: number }>()).results;
  const reviewedIds = all.filter((row) => Boolean(row.reviewed)).map((row) => Number(row.id));
  if (!reviewedIds.length) return Response.json({ error: "请至少先人工确认一道题目", report: { total: all.length, ready: 0, blocked: 0, unreviewed: all.length } }, { status: 409 });
  const result = await reviewQuestions(reviewedIds, "confirm", { requireReviewed: true });
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM questions WHERE question_set_id=? AND status='review'").bind(id).first<{ count: number }>();
  await audit(access, "confirm", "question_set", id, { promoted: result.updated, blocked: result.blocked.length, remaining: Number(remaining?.count || 0) });
  if (!result.updated) return Response.json({ error: "当前没有满足正式入库条件的已校对题目", blocked: result.blocked, report: { total: all.length, ready: 0, blocked: result.blocked.length, unreviewed: all.length - reviewedIds.length } }, { status: 409 });
  return Response.json({ ok: true, partial: Number(remaining?.count || 0) > 0, promoted: result.updated, blocked: result.blocked, report: { total: all.length, ready: result.updated, blocked: result.blocked.length, unreviewed: all.length - reviewedIds.length } });
}
