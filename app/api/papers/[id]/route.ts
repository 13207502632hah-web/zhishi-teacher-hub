import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { paperQuestions, papers } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("papers:read"); if (isDenied(access)) return access; const { id } = await context.params, [paper, questionRows] = await Promise.all([env.DB.prepare("SELECT * FROM papers WHERE id=?").bind(Number(id)).first(), env.DB.prepare("SELECT q.*,pq.position,pq.score AS paperScore FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position").bind(Number(id)).all()]); return paper ? Response.json({ paper, questions: questionRows.results }) : Response.json({ error: "试卷不存在" }, { status: 404 }); }
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("papers:write"); if (isDenied(access)) return access; const { id } = await context.params, value = Number(id), db = getDb(); await db.delete(paperQuestions).where(eq(paperQuestions.paperId, value)); await db.delete(papers).where(eq(papers.id, value)); await audit(access, "delete", "paper", id); return Response.json({ ok: true }); }
