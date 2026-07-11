import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { paperQuestions, papers } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), [paper, questionRows] = await Promise.all([env.DB.prepare("SELECT * FROM papers WHERE id=?").bind(id).first(), env.DB.prepare("SELECT q.*,pq.position,pq.score AS paperScore FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position").bind(id).all()]);
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const questions = questionRows.results as Array<Record<string, unknown>>, questionTypes = questions.reduce<Record<string, number>>((all, question) => { const key = String(question.question_type || question.questionType || "未分类"); all[key] = (all[key] || 0) + 1; return all; }, {}), difficulties = questions.reduce<Record<string, number>>((all, question) => { const key = String(question.difficulty || "未标注"); all[key] = (all[key] || 0) + 1; return all; }, {}), knowledge = [...new Set(questions.map((question) => String(question.knowledge_points || question.knowledgePoints || "").trim()).filter(Boolean))];
  return Response.json({ paper, questions, stats: { questionTypes, difficulties, knowledge } });
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), existing = await env.DB.prepare("SELECT * FROM papers WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!existing) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const db = getDb(), [copy] = await db.insert(papers).values({ title: `${existing.title}（副本）`, type: String(existing.type), stage: String(existing.stage || ""), grade: String(existing.grade || ""), textbookVersion: String(existing.textbook_version || ""), durationMinutes: existing.duration_minutes ? Number(existing.duration_minutes) : null, instructions: String(existing.instructions || ""), totalScore: Number(existing.total_score || 0), status: "draft" }).returning();
  const rows = await env.DB.prepare("SELECT question_id AS questionId,position,score FROM paper_questions WHERE paper_id=? ORDER BY position").bind(id).all<{ questionId: number; position: number; score: number }>();
  if (rows.results.length) await db.insert(paperQuestions).values(rows.results.map((row) => ({ paperId: copy.id, questionId: row.questionId, position: row.position, score: row.score })));
  await audit(access, "copy", "paper", copy.id, { sourceId: id });
  return Response.json({ paper: copy }, { status: 201 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), db = getDb();
  await db.delete(paperQuestions).where(eq(paperQuestions.paperId, id));
  const [paper] = await db.delete(papers).where(eq(papers.id, id)).returning();
  await audit(access, "delete", "paper", id);
  return paper ? Response.json({ ok: true }) : Response.json({ error: "试卷不存在" }, { status: 404 });
}
