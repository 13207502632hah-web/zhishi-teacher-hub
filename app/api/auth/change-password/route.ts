import { audit, isDenied, requirePermission } from "../../../lib/access";
import { changeTeacherAdminPassword, createTeacherAdminSessionCookie } from "../../../lib/teacher-auth";

export async function POST(request: Request) {
  const access = await requirePermission("settings:write");
  if (isDenied(access)) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const confirmPassword = String(body.confirmPassword || "");
  if (newPassword !== confirmPassword) return Response.json({ error: "两次输入的新密码不一致" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const result = await changeTeacherAdminPassword(currentPassword, newPassword);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  await audit(access, "change_password", "teacher_admin", access.id, { otherSessionsInvalidated: true });
  const response = Response.json({ ok: true, message: "密码已更新，其他设备上的旧会话已失效" }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", await createTeacherAdminSessionCookie());
  return response;
}
