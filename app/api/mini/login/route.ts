import { env } from "cloudflare:workers";
import { miniTokenHash, type MiniAccess } from "../../../lib/mini-auth";
import { miniAccountState } from "../../../lib/services/mini-binding-service";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, string>;
  const runtime = env as unknown as Record<string, string | undefined>;
  const testEnabled = runtime.WECHAT_TEST_MODE === "true" && runtime.NODE_ENV !== "production" && runtime.CF_PAGES_ENV !== "production";
  let openId = "";
  const requestedRole: MiniAccess["role"] = body.role === "teacher" || body.role === "parent" ? body.role : "student";
  const role: MiniAccess["role"] = body.testCode && testEnabled ? requestedRole : "student";
  if (body.testCode) {
    if (!testEnabled) return Response.json({ error: "当前环境禁止测试登录" }, { status: 403 });
    openId = `test:${body.testCode}`;
  } else {
    if (!runtime.WECHAT_APP_ID || !runtime.WECHAT_APP_SECRET) return Response.json({ error: "小程序 AppID 尚未配置，当前只能在本地开发者工具使用测试模式" }, { status: 503 });
    if (!body.code) return Response.json({ error: "缺少微信登录 code" }, { status: 400 });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(runtime.WECHAT_APP_ID)}&secret=${encodeURIComponent(runtime.WECHAT_APP_SECRET)}&js_code=${encodeURIComponent(body.code)}&grant_type=authorization_code`);
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || !data.openid) return Response.json({ error: "微信登录失败，请重试" }, { status: 401 });
    openId = String(data.openid);
  }
  let account = await env.DB.prepare("SELECT id,role,status,student_id AS studentId,user_id AS userId FROM wechat_accounts WHERE open_id=?").bind(openId).first<Record<string, any>>();
  if (!account) {
    let linkedUserId: number | null = null;
    if (role === "teacher" && testEnabled) linkedUserId = Number((await env.DB.prepare("SELECT id FROM users WHERE email='teacher-admin@local.invalid' AND status='active'").first<{ id: number }>())?.id || 0) || null;
    account = await env.DB.prepare("INSERT INTO wechat_accounts(open_id,role,display_name,status,user_id) VALUES(?,?,?,'active',?) RETURNING id,role,status,student_id AS studentId,user_id AS userId")
      .bind(openId, role, body.displayName || "待绑定用户", linkedUserId).first<Record<string, any>>();
  }
  if (account?.status !== "active") return Response.json({ error: "当前小程序账号已被停用" }, { status: 403 });
  const token = crypto.randomUUID() + crypto.randomUUID(), hash = await miniTokenHash(token), sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO mini_sessions(id,account_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(sessionId, account.id, hash, expiresAt).run();
  const access: MiniAccess = { accountId: Number(account.id), role: account.role, studentId: account.studentId || null, userId: account.userId || null, sessionId, expiresAt };
  const state = await miniAccountState(access, expiresAt);
  return Response.json({ token, ...state, features: { ...state.features, testLogin: testEnabled } });
}
