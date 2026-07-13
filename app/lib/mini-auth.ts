import { env } from "cloudflare:workers";

export type MiniAccess = {
  accountId: number;
  role: "teacher" | "student" | "parent";
  studentId: number | null;
  userId: number | null;
  sessionId: string;
  expiresAt: string;
};

export async function miniTokenHash(token: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireMini(request: Request, roles?: MiniAccess["role"][]): Promise<MiniAccess | Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) return Response.json({ error: "请先登录小程序", code: "MINI_AUTH_REQUIRED" }, { status: 401 });
  const hash = await miniTokenHash(token);
  const row = await env.DB.prepare("SELECT wa.id AS accountId,wa.role,wa.student_id AS studentId,wa.user_id AS userId,ms.id AS sessionId,ms.expires_at AS expiresAt FROM mini_sessions ms JOIN wechat_accounts wa ON wa.id=ms.account_id WHERE ms.token_hash=? AND ms.expires_at>CURRENT_TIMESTAMP AND wa.status='active'")
    .bind(hash).first<MiniAccess>();
  if (!row) return Response.json({ error: "登录已过期，请重新登录", code: "MINI_SESSION_EXPIRED" }, { status: 401 });
  if (row.role === "teacher" && !row.userId) return Response.json({ error: "教师小程序账号尚未关联网站教师，不能读取工作区数据" }, { status: 403 });
  if (roles && !roles.includes(row.role)) return Response.json({ error: "当前身份无权执行此操作" }, { status: 403 });
  return row;
}

export const miniDenied = (value: MiniAccess | Response): value is Response => value instanceof Response;
