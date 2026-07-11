import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { questions, questionSets } from "../../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const { id } = await context.params, value = Number(id), db = getDb(); await db.update(questions).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(questions.questionSetId, value)); await db.update(questionSets).set({ status: "active", updatedAt: new Date().toISOString() }).where(eq(questionSets.id, value)); await audit(access, "confirm", "question_set", id, { status: "active" }); return Response.json({ ok: true }); }
