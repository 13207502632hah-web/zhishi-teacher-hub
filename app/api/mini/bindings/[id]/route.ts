import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { decideBinding } from "../../../../lib/services/mini-binding-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as Record<string, string>;
  const decision = body.decision === "reject" || body.decision === "disable" ? body.decision : "confirm";
  const response = await decideBinding(access, id, decision);
  if (response.ok) await audit(access, decision, "mini_binding", id);
  return response;
}
