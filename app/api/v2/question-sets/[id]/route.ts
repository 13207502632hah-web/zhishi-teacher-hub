import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { questions, questionSets } from "../../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { env } from "cloudflare:workers";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:read");
  if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "导入任务编号无效" }, { status: 400 });
  const db = getDb();
  const [questionSet] = await db.select().from(questionSets).where(eq(questionSets.id, id)).limit(1);
  if (!questionSet) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const rows = await db.select().from(questions).where(eq(questions.questionSetId, id)).orderBy(asc(questions.id));
  return Response.json({ questionSet, questions: rows });
}

/** Explicitly admit a previously imported set without claiming human review. */
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write");
  if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "导入任务编号无效" }, { status: 400 });
  const existing = await env.DB.prepare("SELECT id FROM question_sets WHERE id=?").bind(id).first();
  if (!existing) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE questions SET status='active',review_status=CASE WHEN reviewed=1 THEN 'confirmed' ELSE 'auto_checked' END,updated_at=CURRENT_TIMESTAMP WHERE question_set_id=? AND status='review' AND trim(stem)!='' RETURNING id").bind(id),
    env.DB.prepare("UPDATE question_sets SET status='active',parse_stage='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id),
  ]);
  // D1 meta.changes also counts FTS trigger writes; RETURNING counts actual questions.
  const count = results[0]?.results?.length || 0;
  await audit(access, "auto_admit_import", "question_set", id, { count, humanReviewClaimed: false });
  return Response.json({ count, status: "active" });
}
