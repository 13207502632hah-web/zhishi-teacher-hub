import { isDenied, requirePermission } from "../../../../lib/access";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { listBindings, listRegistrationRequests, requestMiniRegistration } from "../../../../lib/services/mini-binding-service";

export async function GET() {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const [registrations, bindings] = await Promise.all([listRegistrationRequests(), listBindings()]);
  return Response.json({ registrations, bindings });
}

export async function POST(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>;
  return requestMiniRegistration(access, body);
}
