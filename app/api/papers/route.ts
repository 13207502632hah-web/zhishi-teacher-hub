import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { paperQuestions, papers } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";

const value = (input: unknown) => String(input || "").trim();

export async function GET() {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const result = await env.DB.prepare("SELECT p.*,COUNT(pq.id) AS questionCount,COALESCE(SUM(pq.score),0) AS calculatedScore FROM papers p LEFT JOIN paper_questions pq ON pq.paper_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC").all();
  return Response.json({ papers: result.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, title = value(body.title), input = Array.isArray(body.questions) ? body.questions : [], selected = input.map((item) => ({ id: Number((item as Record<string, unknown>).id), score: Number((item as Record<string, unknown>).score || 0) })).filter((item) => Number.isFinite(item.id) && item.id > 0), ids = [...new Set(selected.map((item) => item.id))];
  if (!title || !selected.length) return Response.json({ error: "试卷名称和题目不能为空" }, { status: 400 });
  if (ids.length !== selected.length) return Response.json({ error: "同一道题不能重复加入同一份试卷" }, { status: 400 });
  if (selected.some((item) => !Number.isFinite(item.score) || item.score < 0)) return Response.json({ error: "分值必须是非负数字" }, { status: 400 });
  const actual = await env.DB.prepare(`SELECT id FROM questions WHERE status='active' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  if (actual.results.length !== ids.length) return Response.json({ error: "所选题目中包含不存在或未正式入库的题目" }, { status: 400 });
  const total = selected.reduce((sum, item) => sum + item.score, 0), db = getDb(), [paper] = await db.insert(papers).values({ title, type: value(body.type) || "练习", stage: value(body.stage), grade: value(body.grade), textbookVersion: value(body.textbookVersion), durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : null, instructions: value(body.instructions), totalScore: total, status: "draft" }).returning();
  await db.insert(paperQuestions).values(selected.map((item, index) => ({ paperId: paper.id, questionId: item.id, position: index + 1, score: item.score })));
  await env.DB.batch(selected.map((item) => env.DB.prepare("UPDATE questions SET use_count=use_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id)));
  await audit(access, "create", "paper", paper.id, { questionCount: selected.length, totalScore: total });
  return Response.json({ paper }, { status: 201 });
}
