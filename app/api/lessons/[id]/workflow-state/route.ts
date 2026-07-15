import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const parse = (value?: string | null) => { try { return value ? JSON.parse(value) : {}; } catch { return {}; } };

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const state = await env.DB.prepare("SELECT revision,draft_payload AS draftPayload,homework_paper_id AS homeworkPaperId,homework_assignment_id AS homeworkAssignmentId,updated_at AS updatedAt FROM lesson_workflow_state WHERE lesson_id=?").bind(id).first<Record<string, any>>();
  return Response.json({ state: state ? { ...state, payload: parse(state.draftPayload) } : { revision: 0, payload: {}, homeworkPaperId: null, homeworkAssignmentId: null, updatedAt: null } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const body = await request.json() as Record<string, any>, revision = Math.max(0, Number(body.revision || 0)), serialized = JSON.stringify(body.payload || {});
  if (serialized.length > 200_000) return Response.json({ error: "课后记录草稿过大，请精简后再保存" }, { status: 413 });
  const current = await env.DB.prepare("SELECT revision,draft_payload AS draftPayload,updated_at AS updatedAt FROM lesson_workflow_state WHERE lesson_id=?").bind(id).first<Record<string, any>>();
  if (current && Number(current.revision) !== revision) return Response.json({ error: "这份草稿已在其他页面更新，请重新载入后合并", conflict: { revision: current.revision, payload: parse(current.draftPayload), updatedAt: current.updatedAt } }, { status: 409 });
  const nextRevision = revision + 1;
  if (current) await env.DB.prepare("UPDATE lesson_workflow_state SET revision=?,draft_payload=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE lesson_id=? AND revision=?").bind(nextRevision, serialized, access.id, id, revision).run();
  else await env.DB.prepare("INSERT INTO lesson_workflow_state(lesson_id,revision,draft_payload,updated_by) VALUES(?,?,?,?)").bind(id, nextRevision, serialized, access.id).run();
  await audit(access, "autosave", "lesson_workflow_state", id, { revision: nextRevision });
  return Response.json({ ok: true, revision: nextRevision });
}
