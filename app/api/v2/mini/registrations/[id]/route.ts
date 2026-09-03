import { audit, isDenied, requirePermission } from "../../../../../lib/access";
import { decideRegistration } from "../../../../../lib/services/mini-binding-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!id) return Response.json({ error: "注册申请编号无效" }, { status: 400 });
  const body = await request.json() as Record<string, unknown>;
  if (body.decision !== "approve" && body.decision !== "reject") return Response.json({ error: "处理动作无效" }, { status: 400 });
  const decision = body.decision;
  const response = await decideRegistration(access, id, decision, Number(body.studentId || 0));
  if (response.ok) await audit(access, decision, "mini_registration", id, { studentId: Number(body.studentId || 0) || null });
  return response;
}
