import { env } from "cloudflare:workers";
import { miniDisabledResponse, miniProductionDisabled, miniTokenHash, type MiniAccess } from "../../../../lib/mini-auth";
import { miniAccountState } from "../../../../lib/services/mini-binding-service";

function wechatLoginError(data: Record<string, unknown>) {
  const providerCode = typeof data.errcode === "number" ? data.errcode : -1;
  const retryable = providerCode === 40029 || providerCode === 45011 || providerCode === -1;
  const error = providerCode === 40125
    ? "微信登录配置失效，请联系管理员更新小程序密钥"
    : providerCode === 40013
      ? "微信小程序 AppID 配置不一致，请联系管理员"
      : providerCode === 40029
        ? "微信登录凭证已失效，请关闭小程序后重新打开"
        : providerCode === 45011
          ? "微信登录操作过于频繁，请稍后再试"
          : "微信登录服务暂时不可用，请稍后重试";
  return Response.json({ error, code: "WECHAT_LOGIN_FAILED", providerCode, retryable }, { status: retryable ? 503 : 401 });
}

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (miniProductionDisabled()) return miniDisabledResponse();
  const body = await request.json() as Record<string, string>;
  const testEnabled = runtime.WECHAT_TEST_MODE === "true" && runtime.NODE_ENV !== "production" && runtime.CF_PAGES_ENV !== "production";
  let openId = "";
  if (body.role && body.role !== "student" && body.role !== "parent") return Response.json({ error: "小程序一期只支持学生和家长，教师请使用网站或 iOS 端" }, { status: 400 });
  const requestedRole: MiniAccess["role"] = body.role === "parent" ? "parent" : "student";
  const role: MiniAccess["role"] = body.testCode && testEnabled ? requestedRole : "student";
  if (body.testCode) {
    if (!testEnabled) return Response.json({ error: "当前环境禁止测试登录" }, { status: 403 });
    openId = `test:${body.testCode}`;
  } else {
    if (!runtime.WECHAT_APP_ID || !runtime.WECHAT_APP_SECRET) return Response.json({ error: "小程序 AppID 尚未配置，当前只能在本地开发者工具使用测试模式" }, { status: 503 });
    if (!body.code) return Response.json({ error: "缺少微信登录 code" }, { status: 400 });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(runtime.WECHAT_APP_ID)}&secret=${encodeURIComponent(runtime.WECHAT_APP_SECRET)}&js_code=${encodeURIComponent(body.code)}&grant_type=authorization_code`);
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || !data.openid) return wechatLoginError(data);
    openId = String(data.openid);
  }
  let account = await env.DB.prepare("SELECT id,role,status,student_id AS studentId FROM wechat_accounts WHERE open_id=?").bind(openId).first<Record<string, any>>();
  if (!account) {
    account = await env.DB.prepare("INSERT INTO wechat_accounts(open_id,role,display_name,status) VALUES(?,?,?,'active') RETURNING id,role,status,student_id AS studentId")
      .bind(openId, role, body.displayName || "待绑定用户").first<Record<string, any>>();
  }
  if (account?.status !== "active") return Response.json({ error: "当前小程序账号已被停用" }, { status: 403 });
  if (account?.role !== "student" && account?.role !== "parent") return Response.json({ error: "教师请使用网站或 iOS 端", code: "MINI_ROLE_UNSUPPORTED" }, { status: 403 });
  const token = crypto.randomUUID() + crypto.randomUUID(), hash = await miniTokenHash(token), sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO mini_sessions(id,account_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(sessionId, account.id, hash, expiresAt).run();
  const access: MiniAccess = { accountId: Number(account.id), role: account.role, studentId: account.studentId || null, sessionId, expiresAt };
  const state = await miniAccountState(access, expiresAt);
  return Response.json({ token, ...state, features: { ...state.features, testLogin: testEnabled } });
}
