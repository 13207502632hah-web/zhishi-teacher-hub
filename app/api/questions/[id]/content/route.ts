import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "题目编号无效" }, { status: 400 });
  const row = await env.DB.prepare("SELECT id,answer,analysis,answer_points AS answerPoints,scoring_points AS scoringPoints,standard_expression AS standardExpression,updated_at AS updatedAt FROM questions WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "题目不存在" }, { status: 404 });
  return Response.json({ content: row, missing: { answer: !String(row.answer || "").trim(), analysis: !String(row.analysis || "").trim() } });
}
