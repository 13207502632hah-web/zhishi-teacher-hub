import { clearTeacherAdminSessionCookie, safeReturnPath } from "../../../lib/teacher-auth";

export async function GET(request: Request) {
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return_to") || "/resources");
  return new Response(null, { status: 303, headers: { Location: returnTo, "Set-Cookie": clearTeacherAdminSessionCookie(), "Cache-Control": "no-store" } });
}
