import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function GET() {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const accounts = await env.DB.prepare("SELECT wa.id,wa.role,wa.display_name AS displayName,wa.status,wa.user_id AS userId,u.name AS linkedTeacher,wa.created_at AS createdAt FROM wechat_accounts wa LEFT JOIN users u ON u.id=wa.user_id ORDER BY wa.updated_at DESC").all();
  return Response.json({ accounts: accounts.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, accountId = Number(body.accountId);
  if (!accountId || body.action !== "linkTeacher") return Response.json({ error: "无效的教师端关联请求" }, { status: 400 });
  const account = await env.DB.prepare("SELECT id,status,role,user_id AS userId FROM wechat_accounts WHERE id=?").bind(accountId).first<Record<string, unknown>>();
  if (!account) return Response.json({ error: "微信账号不存在" }, { status: 404 });
  if (account.status !== "active") return Response.json({ error: "已停用账号不能关联教师端" }, { status: 409 });
  const linkedTeacherId = Number(account.userId || 0);
  if (linkedTeacherId && linkedTeacherId !== access.id) return Response.json({ error: "该小程序账号已关联其他教师，不能越权接管" }, { status: 409 });
  if (account.role === "teacher" && linkedTeacherId === access.id) return Response.json({ ok: true, accountId, role: "teacher", alreadyLinked: true });
  await env.DB.batch([
    env.DB.prepare("UPDATE wechat_accounts SET role='teacher',user_id=?,student_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(access.id, accountId),
    env.DB.prepare("UPDATE mini_bindings SET status='disabled',disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND status IN ('pending','active')").bind(accountId),
  ]);
  await audit(access, "link_teacher", "wechat_account", accountId);
  return Response.json({ ok: true, accountId, role: "teacher" });
}
