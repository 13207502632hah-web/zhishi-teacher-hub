import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { questions, questionSets } from "../../../../db/schema";
import { isDenied, requirePermission } from "../../../lib/access";

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
