import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../../lib/access";

const text = (input: unknown, max: number) => String(input || "").trim().slice(0, max);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), existing = await env.DB.prepare("SELECT id,status FROM questions WHERE id=?").bind(id).first<{ id: number; status: string }>();
  if (!existing) return Response.json({ error: "题目不存在" }, { status: 404 });
  if (existing.status === "active") return Response.json({ error: "正式题库中的题目不能通过导入校对工作台修改" }, { status: 409 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>, stem = text(body.stem, 20_000), answer = text(body.answer, 20_000), analysis = text(body.analysis, 30_000), knowledgePoints = text(body.knowledgePoints, 5_000), questionType = text(body.questionType, 100) || "材料题", difficulty = Math.max(1, Math.min(5, Number(body.difficulty || 3)));
  if (!stem) return Response.json({ error: "题干不能为空" }, { status: 400 });
  await env.DB.prepare("UPDATE questions SET stem=?,answer=?,analysis=?,knowledge_points=?,question_type=?,difficulty=?,review_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(stem, answer || null, analysis || null, knowledgePoints || null, questionType, difficulty, id).run();
  await audit(access, "v2_review_draft_update", "question", id, { answerReady: Boolean(answer), knowledgeReady: Boolean(knowledgePoints) });
  return Response.json({ question: { id, stem, answer, analysis, knowledgePoints, questionType, difficulty, reviewStatus: "pending" } });
}
