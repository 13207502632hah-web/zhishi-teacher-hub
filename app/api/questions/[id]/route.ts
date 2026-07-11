import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { questions } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionValues } from "../values";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("questions:read"); if (isDenied(access)) return access; const id = await idFrom(context), [row] = await getDb().select().from(questions).where(eq(questions.id, id)).limit(1); return row ? Response.json({ question: row }) : Response.json({ error: "题目不存在" }, { status: 404 }); }

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), body = await request.json() as Record<string, unknown>, data = questionValues({ ...body, recordedBy: access.name });
  if (!data.stem) return Response.json({ error: "题干不能为空" }, { status: 400 });
  const existing = await env.DB.prepare("SELECT id,stem FROM questions WHERE fingerprint=? AND id!=? LIMIT 1").bind(data.fingerprint, id).first<Record<string, unknown>>();
  if (existing) return Response.json({ error: "题库中已有高度相同的题目，请先核对后再保存", duplicate: existing }, { status: 409 });
  const [question] = await getDb().update(questions).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(questions.id, id)).returning();
  await audit(access, "update", "question", id);
  return question ? Response.json({ question }) : Response.json({ error: "题目不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), body = await request.json() as Record<string, unknown>, allowed = ["isFavorite", "isWrong", "isFrequent", "status"] as const, data: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) if (key in body) data[key] = body[key];
  const [question] = await getDb().update(questions).set(data).where(eq(questions.id, id)).returning();
  await audit(access, "update_flags", "question", id, { fields: Object.keys(body) });
  return question ? Response.json({ question }) : Response.json({ error: "题目不存在" }, { status: 404 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), referenced = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM paper_questions WHERE question_id=?) AS paperCount,(SELECT COUNT(*) FROM lesson_questions WHERE question_id=?) AS lessonCount").bind(id, id).first<{ paperCount: number; lessonCount: number }>();
  if (Number(referenced?.paperCount || 0) || Number(referenced?.lessonCount || 0)) return Response.json({ error: "该题已被试卷或课时引用，不能直接删除；请保留记录或先解除关联", references: referenced }, { status: 409 });
  const [question] = await getDb().delete(questions).where(eq(questions.id, id)).returning();
  await audit(access, "delete", "question", id);
  return question ? Response.json({ ok: true }) : Response.json({ error: "题目不存在" }, { status: 404 });
}
