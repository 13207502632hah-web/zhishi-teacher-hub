import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { reviewQuestions } from "../../../../lib/services/question-review-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json().catch(() => ({})) as Record<string, unknown>, action = String(body.action || "confirm");
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "题目编号无效" }, { status: 400 });
  if (!(["confirm", "return", "ignore"] as string[]).includes(action)) return Response.json({ error: "不支持的审核动作" }, { status: 400 });
  const result = await reviewQuestions([id], action as "confirm" | "return" | "ignore", { expectedUpdatedAt: body.expectedUpdatedAt ? String(body.expectedUpdatedAt) : undefined });
  if (result.stale?.length) return Response.json({ error: "题目已在其他页面更新，请刷新后重新审核", stale: result.stale }, { status: 409 });
  if (!result.ok) return Response.json({ error: result.blocked.length ? "题目尚未满足正式入库条件" : "题目不存在或审核未执行", blocked: result.blocked }, { status: result.blocked.length ? 409 : 404 });
  await audit(access, `review_${action}`, "question", id, { blocked: result.blocked.length });
  return Response.json(result);
}
