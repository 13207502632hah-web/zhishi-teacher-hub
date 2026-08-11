import { env } from "cloudflare:workers";

export type MiniAccess = {
  accountId: number;
  role: "student" | "parent";
  studentId: number | null;
  sessionId: string;
  expiresAt: string;
};

export function miniProductionDisabled() {
  const runtime = env as unknown as Record<string, string | undefined>;
  const production = runtime.NODE_ENV === "production" || runtime.CF_PAGES_ENV === "production";
  return production && runtime.MINI_FEATURE_ENABLED !== "true";
}

export function miniDisabledResponse() {
  return Response.json({ error: "小程序尚未通过生产验收，当前环境未开放", code: "MINI_FEATURE_DISABLED" }, { status: 503 });
}

export async function miniTokenHash(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireMini(request: Request, roles?: MiniAccess["role"][]): Promise<MiniAccess | Response> {
  if (miniProductionDisabled()) return miniDisabledResponse();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) return Response.json({ error: "请先登录小程序", code: "MINI_AUTH_REQUIRED" }, { status: 401 });
  const hash = await miniTokenHash(token);
  const row = await env.DB.prepare("SELECT wa.id AS accountId,wa.role,wa.student_id AS studentId,ms.id AS sessionId,ms.expires_at AS expiresAt FROM mini_sessions ms JOIN wechat_accounts wa ON wa.id=ms.account_id WHERE ms.token_hash=? AND ms.expires_at>CURRENT_TIMESTAMP AND wa.status='active'")
    .bind(hash).first<Omit<MiniAccess, "role"> & { role: string }>();
  if (!row) return Response.json({ error: "登录已过期，请重新登录", code: "MINI_SESSION_EXPIRED" }, { status: 401 });
  if (row.role !== "student" && row.role !== "parent") return Response.json({ error: "教师请使用网站或 iOS 端", code: "MINI_ROLE_UNSUPPORTED" }, { status: 403 });
  if (roles && !roles.includes(row.role)) return Response.json({ error: "当前身份无权执行此操作" }, { status: 403 });
  return { ...row, role: row.role };
}

export const miniDenied = (value: MiniAccess | Response): value is Response => value instanceof Response;
