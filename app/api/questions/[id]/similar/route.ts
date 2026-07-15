import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";
import { questionTextSimilarity } from "../../../../lib/question-similarity";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), source = await env.DB.prepare("SELECT id,stem,stage,grade,question_type AS questionType,knowledge_points AS knowledgePoints FROM questions WHERE id=?").bind(id).first<Record<string, any>>();
  if (!source) return Response.json({ error: "题目不存在" }, { status: 404 });
  const pool = await env.DB.prepare("SELECT id,stem,question_type AS questionType,knowledge_points AS knowledgePoints,answer,analysis FROM questions WHERE status='active' AND id!=? AND stage=? AND grade=? ORDER BY updated_at DESC LIMIT 1000").bind(id, source.stage || "", source.grade || "").all<Record<string, any>>();
  const similar = pool.results.map((item) => ({ ...item, similarity: questionTextSimilarity(source.stem, item.stem) })).filter((item) => item.similarity >= .82).sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  return Response.json({ source, similar, note: "相似度只用于人工并排核对，系统不会自动删除或合并题目。" });
}
