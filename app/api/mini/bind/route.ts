import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { requestMiniBinding } from "../../../lib/services/mini-binding-service";

export async function POST(request: Request) {
  // 统一服务对无效、已使用或过期的邀请码返回“邀请码无效或已过期”。
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const body = await request.json() as Record<string, string>;
  return requestMiniBinding(access, String(body.code || ""));
}
