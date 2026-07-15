import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../../lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>, questionIds = [...new Set((Array.isArray(body.questionIds) ? body.questionIds : []).map(Number).filter((value) => value > 0))].slice(0, 50), purpose = String(body.purpose || "课堂练习").slice(0, 30);
  if (!questionIds.length) return Response.json({ error: "请至少选择一道正式题目" }, { status: 400 });
  const marks = questionIds.map(() => "?").join(","), active = await env.DB.prepare(`SELECT id FROM questions WHERE status='active' AND id IN (${marks})`).bind(...questionIds).all<{ id: number }>();
  if (active.results.length !== questionIds.length) return Response.json({ error: "所选题目中包含未正式入库或不存在的题目" }, { status: 409 });
  const existing = await env.DB.prepare(`SELECT question_id AS questionId FROM lesson_questions WHERE lesson_id=? AND question_id IN (${marks})`).bind(id, ...questionIds).all<{ questionId: number }>(), existingIds = new Set(existing.results.map((item) => Number(item.questionId))), additions = active.results.filter((item) => !existingIds.has(Number(item.id)));
  const maximum = await env.DB.prepare("SELECT COALESCE(MAX(position),-1) AS position FROM lesson_questions WHERE lesson_id=?").bind(id).first<{ position: number }>(), statements = additions.map((item, index) => env.DB.prepare("INSERT INTO lesson_questions(lesson_id,question_id,purpose,position) VALUES(?,?,?,?)").bind(id, item.id, purpose, Number(maximum?.position || -1) + index + 1));
  if (statements.length) await env.DB.batch(statements);
  await audit(access, "link_questions", "lesson", id, { requested: active.results.length, linked: additions.length, purpose });
  return Response.json({ ok: true, linked: additions.length, alreadyLinked: active.results.length - additions.length });
}
