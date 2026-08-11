import { audit, isDenied, requirePermission } from "../../../lib/access";
import { changeStaffPassword, createStaffSessionCookie } from "../../../lib/staff-auth";

export async function POST(request: Request) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  if (access.authType !== "staff") return Response.json({ error: "主教师管理员请在系统设置中修改密码" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>, currentPassword = String(body.currentPassword || ""), newPassword = String(body.newPassword || ""), confirmPassword = String(body.confirmPassword || "");
  if (newPassword !== confirmPassword) return Response.json({ error: "两次输入的新密码不一致" }, { status: 400 });
  const result = await changeStaffPassword(access.id, currentPassword, newPassword);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  await audit(access, "change_password", "staff_user", access.id, { otherSessionsInvalidated: true });
  const response = Response.json({ ok: true, message: "密码已更新，其他设备上的旧会话已失效" }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", await createStaffSessionCookie(access.id));
  return response;
}
