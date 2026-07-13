import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { questions, questionSets } from "../../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), db = getDb(), [set] = await db.select().from(questionSets).where(eq(questionSets.id, id)).limit(1);
  if (!set) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const all = await db.select().from(questions).where(eq(questions.questionSetId, id));
  const pending = all.filter((item) => !item.reviewed || !item.answer || !item.analysis || !item.knowledgePoints);
  if (pending.length) return Response.json({ error: `仍有 ${pending.length} 道题未满足正式入库条件`, blocked: pending.map((item) => item.id), report: { total: all.length, ready: all.length - pending.length, blocked: pending.length } }, { status: 409 });
  await db.update(questions).set({ status: "active", reviewStatus: "confirmed", updatedAt: new Date().toISOString() }).where(eq(questions.questionSetId, id));
  await db.update(questionSets).set({ status: "active", parseStage: "completed", reviewProgress: all.length, updatedAt: new Date().toISOString() }).where(eq(questionSets.id, id));
  await audit(access, "confirm", "question_set", id, { status: "active" });
  return Response.json({ ok: true });
}
