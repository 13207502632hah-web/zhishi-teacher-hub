import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { clearPortalSessionCookie, createPortalSessionCookie } from "../../../lib/portal-auth";

const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  const access = await requireMini(request, ["student", "parent"]);
  if (miniDenied(access)) {
    const headers = new Headers(access.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(access.body, { status: access.status, statusText: access.statusText, headers });
  }
  try {
    const response = Response.json({ ok: true, role: access.role, returnTo: "/portal" }, { headers: responseHeaders });
    response.headers.append("Set-Cookie", await createPortalSessionCookie(access));
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "暂时无法建立门户登录" }, { status: 503, headers: responseHeaders });
  }
}

export async function DELETE() {
  const response = Response.json({ ok: true }, { headers: responseHeaders });
  response.headers.append("Set-Cookie", clearPortalSessionCookie());
  return response;
}

export async function GET() {
  return new Response(null, {
    status: 303,
    headers: { ...responseHeaders, Location: "/portal", "Set-Cookie": clearPortalSessionCookie() },
  });
}
