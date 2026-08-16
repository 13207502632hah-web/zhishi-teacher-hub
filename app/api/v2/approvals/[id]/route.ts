import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { decideApproval, getApproval } from "../../../../lib/v2/approval-service";
import { executeApprovedAction } from "../../../../lib/v2/approval-executor";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  if (access.role !== "teacher") return Response.json({ error: "助教可以创建建议，但只有主教师可以作最终确认" }, { status: 403 });
  const { id } = await context.params, body = await request.json() as Record<string, unknown>;
  const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
  if (!decision) return Response.json({ error: "请选择通过或拒绝" }, { status: 400 });
  const current = await getApproval(access, id);
  if (!current) return Response.json({ error: "审批项不存在" }, { status: 404 });
  if (current.state !== "pending") return current.state === decision ? Response.json({ approval: current, repeated: true, notice: "该审批决定已记录，本次未重复执行" }) : Response.json({ error: "审批项已经处理，不能更改决定" }, { status: 409 });
  let execution: Record<string, unknown> | null = null;
  if (decision === "approved") {
    try { execution = await executeApprovedAction(access, current); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "确认动作执行失败", approval: current }, { status: 409 }); }
  }
  const approval = await decideApproval(access, id, decision, String(body.note || ""));
  if (!approval) return Response.json({ error: "审批项不存在、已处理或已过期" }, { status: 409 });
  await audit(access, decision, "v2_approval", id, { actionType: approval.actionType, entityType: approval.entityType, entityId: approval.entityId, execution });
  return Response.json({ approval, execution, notice: decision === "approved" ? (execution?.executed ? "已确认并完成受控业务写入" : String(execution?.notice || "已记录教师采纳结果")) : "已拒绝；原业务数据未改变" });
}
