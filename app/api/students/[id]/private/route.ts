import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:private"); if (isDenied(access)) return access;
  const { id } = await context.params;
  const student = await env.DB.prepare("SELECT guardian_contact AS guardianContact FROM students WHERE id=?").bind(Number(id)).first();
  if (!student) return Response.json({ error: "学生不存在" }, { status: 404 });
  await audit(access, "view_sensitive", "student", id, { field: "guardianContact" });
  return Response.json({ guardianContact: student.guardianContact || "未填写" }, { headers: { "Cache-Control": "no-store" } });
}
