import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { decideBinding } from "../../../../lib/services/mini-binding-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as Record<string, string>;
  if (body.decision !== "confirm" && body.decision !== "reject" && body.decision !== "disable") return Response.json({ error: "无效的绑定决定" }, { status: 400 });
  const decision = body.decision;
  const response = await decideBinding(access, id, decision);
  if (response.ok) await audit(access, decision, "mini_binding", id);
  return response;
}
