import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../lib/mini-auth";

export async function POST(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  await env.DB.prepare("DELETE FROM mini_sessions WHERE id=? AND account_id=?").bind(access.sessionId, access.accountId).run();
  return Response.json({ ok: true });
}
