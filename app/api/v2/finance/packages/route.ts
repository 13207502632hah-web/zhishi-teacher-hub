import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const studentId = Number(new URL(request.url).searchParams.get("studentId") || 0);
  if (studentId && (!Number.isInteger(studentId) || studentId < 1)) return Response.json({ error: "学生编号无效" }, { status: 400 });
  const rows = await env.DB.prepare(`SELECT lp.*,s.name AS studentName FROM lesson_packages lp JOIN students s ON s.id=lp.student_id ${studentId ? "WHERE lp.student_id=?" : ""} ORDER BY lp.id DESC`).bind(...(studentId ? [studentId] : [])).all();
  return Response.json({ packages: rows.results });
}
