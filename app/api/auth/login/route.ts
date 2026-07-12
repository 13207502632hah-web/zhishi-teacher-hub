import { clearLoginFailures, createTeacherAdminSessionCookie, loginAttemptStatus, recordLoginFailure, safeReturnPath, verifyTeacherAdminCredentials } from "../../../lib/teacher-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const account = String(body.account || "").trim();
  const password = String(body.password || "");
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `ip:${address}`;
  const attempt = await loginAttemptStatus(key);
  if (attempt.blocked) return Response.json({ error: "登录尝试过多，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(attempt.retryAfterSeconds) } });
  if (!await verifyTeacherAdminCredentials(account, password)) {
    await recordLoginFailure(key);
    return Response.json({ error: "账号或密码不正确" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  await clearLoginFailures(key);

  const response = Response.json({ ok: true, returnTo: safeReturnPath(String(body.returnTo || "/workspace")) }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", await createTeacherAdminSessionCookie());
  return response;
}
