import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../../lib/access";
import { recordSyncEvent } from "../../../../lib/services/mini-sync-service";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id); if (!Number.isInteger(id) || id < 1) return Response.json({ error: "文件编号无效" }, { status: 400 });
  const row = await env.DB.prepare("SELECT id,class_id AS classId,title,status FROM class_files WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "班级文件不存在" }, { status: 404 });
  const denied = await requireClassAccess(access, Number(row.classId)); if (denied) return denied;
  if (row.status === "archived") return Response.json({ ok: true, repeated: true });
  await env.DB.prepare("UPDATE class_files SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  const students = await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(row.classId).all<{ studentId: number }>();
  for (const student of students.results) await recordSyncEvent({ eventType: "class_file.archived", entityType: "class_file", entityId: id, studentId: Number(student.studentId), deleted: true, payload: { title: row.title } });
  await audit(access, "archive", "class_file", id, { classId: row.classId, previousStatus: row.status });
  return Response.json({ ok: true, status: "archived" });
}
