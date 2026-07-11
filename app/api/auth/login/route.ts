import { createTeacherAdminSessionCookie, safeReturnPath, verifyTeacherAdminCredentials } from "../../../lib/teacher-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const account = String(body.account || "").trim();
  const password = String(body.password || "");
  if (!await verifyTeacherAdminCredentials(account, password)) {
    return Response.json({ error: "账号或密码不正确" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const response = Response.json({ ok: true, returnTo: safeReturnPath(String(body.returnTo || "/workspace")) }, { headers: { "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", await createTeacherAdminSessionCookie());
  return response;
}
