import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";
import { requireTeacherAdminApi } from "../../../lib/teacher-auth";

const parseJson = (value: string | null, fallback: unknown) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
};

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const teacherAdmin = await requireTeacherAdminApi();
  if (teacherAdmin) return teacherAdmin;
  const access = await requirePermission("lessons:read");
  if (isDenied(access)) return access;

  const importId = Number((await context.params).id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return Response.json({ error: "导入任务编号无效" }, { status: 400 });
  }

  const task = await env.DB
    .prepare(
      "SELECT id,source_name AS sourceName,fingerprint,mapping,report,status,created_at AS createdAt,updated_at AS updatedAt FROM schedule_imports WHERE id=?",
    )
    .bind(importId)
    .first<Record<string, unknown>>();
  if (!task) {
    return Response.json({ error: "导入任务不存在" }, { status: 404 });
  }

  const rows = (await env.DB
    .prepare(
      "SELECT id,row_number AS rowNumber,normalized_data AS normalizedData,action,issue,lesson_id AS lessonId FROM schedule_import_rows WHERE import_id=? ORDER BY row_number",
    )
    .bind(importId)
    .all()).results;

  return Response.json({
    import: {
      ...task,
      mapping: parseJson(String(task.mapping || ""), null),
      report: parseJson(String(task.report || ""), {}),
    },
    rows,
  });
}
