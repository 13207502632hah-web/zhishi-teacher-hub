import { clearLoginFailures, createTeacherAdminSessionCookie, loginAttemptStatus, recordLoginFailure, safeReturnPath, verifyTeacherAdminCredentials } from "../../../lib/teacher-auth";
import { clearStaffLoginFailures, createStaffSessionCookie, recordStaffLoginFailure, staffLoginAttemptStatus, verifyStaffCredentials } from "../../../lib/staff-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const account = String(body.account || "").trim();
  const password = String(body.password || "");
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const key = `ip:${address}`, staffKey = `ip:${address}:account:${account.toLowerCase().slice(0, 160)}`;
  const [attempt, staffAttempt] = await Promise.all([loginAttemptStatus(key), staffLoginAttemptStatus(staffKey)]);
  if (attempt.blocked) return Response.json({ error: "登录尝试过多，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(attempt.retryAfterSeconds) } });
  if (staffAttempt.blocked) return Response.json({ error: "该账号登录尝试过多，请稍后再试" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(staffAttempt.retryAfterSeconds) } });
  const adminValid = await verifyTeacherAdminCredentials(account, password), staff = adminValid ? null : await verifyStaffCredentials(account, password);
  if (!adminValid && !staff) {
    await Promise.all([recordLoginFailure(key), recordStaffLoginFailure(staffKey)]);
    return Response.json({ error: "账号或密码不正确" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  await Promise.all([clearLoginFailures(key), clearStaffLoginFailures(staffKey)]);

  const response = Response.json({ ok: true, role: staff?.role || "teacher", returnTo: safeReturnPath(String(body.returnTo || "/v2")) }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", adminValid ? await createTeacherAdminSessionCookie() : await createStaffSessionCookie(Number(staff?.userId)));
  return response;
}
