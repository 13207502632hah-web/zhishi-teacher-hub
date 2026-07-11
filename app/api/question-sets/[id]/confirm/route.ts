import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { questions, questionSets } from "../../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), db = getDb(), [set] = await db.select().from(questionSets).where(eq(questionSets.id, id)).limit(1);
  if (!set) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const pending = await db.select({ id: questions.id }).from(questions).where(and(eq(questions.questionSetId, id), eq(questions.reviewed, false))).limit(1);
  if (pending.length) return Response.json({ error: "仍有题目未完成教师复核，不能进入正式题库" }, { status: 409 });
  await db.update(questions).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(questions.questionSetId, id));
  await db.update(questionSets).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(questionSets.id, id));
  await audit(access, "confirm", "question_set", id, { status: "active" });
  return Response.json({ ok: true });
}
