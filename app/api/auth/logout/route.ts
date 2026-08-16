import { clearTeacherAdminSessionCookie, safeReturnPath } from "../../../lib/teacher-auth";
import { clearStaffSessionCookie } from "../../../lib/staff-auth";

export async function GET(request: Request) {
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return_to") || "/resources");
  const response = new Response(null, { status: 303, headers: { Location: returnTo, "Cache-Control": "no-store" } });
  response.headers.append("Set-Cookie", clearTeacherAdminSessionCookie());
  response.headers.append("Set-Cookie", clearStaffSessionCookie());
  return response;
}
