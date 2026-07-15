import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { savedQuestionViews } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "筛选方案编号无效" }, { status: 400 });
  const deleted = await getDb().delete(savedQuestionViews).where(and(eq(savedQuestionViews.id, id), eq(savedQuestionViews.ownerId, access.id))).returning({ id: savedQuestionViews.id });
  if (!deleted.length) return Response.json({ error: "筛选方案不存在" }, { status: 404 });
  await audit(access, "delete", "saved_question_view", id, {});
  return Response.json({ ok: true });
}
