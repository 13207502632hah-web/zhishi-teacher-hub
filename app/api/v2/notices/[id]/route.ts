import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../../lib/access";
import { recordSyncEvent } from "../../../../lib/services/mini-sync-service";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id); if (!Number.isInteger(id) || id < 1) return Response.json({ error: "通知编号无效" }, { status: 400 });
  const notice = await env.DB.prepare("SELECT id,class_id AS classId,title,status,audience_role AS audienceRole FROM class_notices WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!notice) return Response.json({ error: "通知不存在" }, { status: 404 });
  const denied = await requireClassAccess(access, Number(notice.classId)); if (denied) return denied;
  if (notice.status === "archived") return Response.json({ ok: true, repeated: true });
  await env.DB.prepare("UPDATE class_notices SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  const students = await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(notice.classId).all<{ studentId: number }>();
  for (const student of students.results) await recordSyncEvent({ eventType: "class_notice.archived", entityType: "class_notice", entityId: id, studentId: Number(student.studentId), audienceRole: notice.audienceRole === "both" ? null : notice.audienceRole as "student" | "parent", deleted: true, payload: { title: notice.title } });
  await audit(access, "archive", "class_notice", id, { classId: notice.classId, previousStatus: notice.status });
  return Response.json({ ok: true, status: "archived" });
}
