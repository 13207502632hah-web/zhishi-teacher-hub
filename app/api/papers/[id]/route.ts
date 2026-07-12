import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { paperQuestions, papers } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const value = (input: unknown) => String(input || "").trim();

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
  for (let index = 0; index < rows.results.length; index += 20) await db.insert(paperQuestions).values(rows.results.slice(index, index + 20).map((row) => ({ paperId: copy.id, questionId: row.questionId, position: row.position, score: row.score })));
  await audit(access, "copy", "paper", copy.id, { sourceId: id });
  return Response.json({ paper: copy }, { status: 201 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), existing = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(id).first();
  if (!existing) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const body = await request.json() as Record<string, unknown>, allowedStatuses = ["draft", "completed", "used", "archived"], requestedStatus = value(body.status);
  if (!Array.isArray(body.questions) && requestedStatus) {
    if (!allowedStatuses.includes(requestedStatus)) return Response.json({ error: "试卷状态无效" }, { status: 400 });
    await getDb().update(papers).set({ status: requestedStatus, updatedAt: new Date().toISOString() }).where(eq(papers.id, id));
    await audit(access, requestedStatus === "archived" ? "archive" : "update_status", "paper", id, { status: requestedStatus });
    return Response.json({ ok: true, paperId: id, status: requestedStatus });
  }
  const title = value(body.title), input = Array.isArray(body.questions) ? body.questions : [], selected = input.map((item) => ({ id: Number((item as Record<string, unknown>).id), score: Number((item as Record<string, unknown>).score || 0) })).filter((item) => Number.isFinite(item.id) && item.id > 0), ids = [...new Set(selected.map((item) => item.id))];
  if (!title || !selected.length) return Response.json({ error: "试卷名称和题目不能为空" }, { status: 400 });
  if (ids.length !== selected.length) return Response.json({ error: "同一道题不能重复加入同一份试卷" }, { status: 400 });
  if (selected.some((item) => !Number.isFinite(item.score) || item.score < 0)) return Response.json({ error: "分值必须是非负数字" }, { status: 400 });
  const actual = await env.DB.prepare(`SELECT id FROM questions WHERE status='active' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  if (actual.results.length !== ids.length) return Response.json({ error: "所选题目中包含不存在或未正式入库的题目" }, { status: 400 });
  const status = requestedStatus || "draft";
  if (!allowedStatuses.includes(status)) return Response.json({ error: "试卷状态无效" }, { status: 400 });
  const total = selected.reduce((sum, item) => sum + item.score, 0), db = getDb();
  await db.update(papers).set({ title, type: value(body.type) || "练习", stage: value(body.stage), grade: value(body.grade), textbookVersion: value(body.textbookVersion), durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : null, instructions: value(body.instructions), totalScore: total, status, updatedAt: new Date().toISOString() }).where(eq(papers.id, id));
  await db.delete(paperQuestions).where(eq(paperQuestions.paperId, id));
  for (let index = 0; index < selected.length; index += 20) await db.insert(paperQuestions).values(selected.slice(index, index + 20).map((item, offset) => ({ paperId: id, questionId: item.id, position: index + offset + 1, score: item.score })));
  await audit(access, "update", "paper", id, { questionCount: selected.length, totalScore: total, status });
  return Response.json({ ok: true, paperId: id, totalScore: total });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), db = getDb();
  await db.delete(paperQuestions).where(eq(paperQuestions.paperId, id));
  const [paper] = await db.delete(papers).where(eq(papers.id, id)).returning();
  await audit(access, "delete", "paper", id);
  return paper ? Response.json({ ok: true }) : Response.json({ error: "试卷不存在" }, { status: 404 });
}
