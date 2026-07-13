import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { miniAccountState } from "../../../lib/services/mini-binding-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  return Response.json(await miniAccountState(access, access.expiresAt));
}
