import { audit, isDenied, requirePermission } from "../../../../../lib/access";
import { disableBinding } from "../../../../../lib/services/mini-binding-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as Record<string, string>;
  if (body.decision !== "disable") return Response.json({ error: "绑定关系只支持停用" }, { status: 400 });
  const response = await disableBinding(access, id);
  if (response.ok) await audit(access, "disable", "mini_binding", id);
  return response;
}
