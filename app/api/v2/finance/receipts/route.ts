import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";
import { createApproval } from "../../../../lib/v2/approval-service";

export async function POST(request: Request) {
  const access = await requirePermission("analytics:write"); if (isDenied(access)) return access;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const lessonId = Number(body?.lessonId || 0), receivedAmount = Number(body?.receivedAmount);
  if (!Number.isInteger(lessonId) || lessonId < 1) return Response.json({ error: "课时编号无效" }, { status: 400 });
  const denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  if (!Number.isFinite(receivedAmount) || receivedAmount < 0) return Response.json({ error: "实收金额必须是非负数字" }, { status: 400 });
  const current = await env.DB.prepare("SELECT lf.id,lf.expected_amount AS expectedAmount,lf.received_amount AS receivedAmount,lf.status,lf.confirmed_at AS confirmedAt,l.date,l.course_name AS courseName FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id WHERE lf.lesson_id=?").bind(lessonId).first<Record<string, unknown>>();
  if (!current?.confirmedAt) return Response.json({ error: "请先完成本节课的结算确认" }, { status: 409 });
  const operationId = `v2-receive-${lessonId}-${crypto.randomUUID()}`;
  const approval = await createApproval(access, {
    actionType: "finance.receive", entityType: "lesson_finance", entityId: String(current.id),
    title: `登记实收：${String(current.courseName || `课时 #${lessonId}`)}`,
    summary: `应收 ¥${Number(current.expectedAmount || 0).toFixed(2)}，当前实收 ¥${Number(current.receivedAmount || 0).toFixed(2)}，拟更新为 ¥${receivedAmount.toFixed(2)}。`,
    payload: { lessonId, financeId: Number(current.id), expectedAmount: Number(current.expectedAmount || 0), currentReceived: Number(current.receivedAmount || 0), receivedAmount, operationId },
    evidence: [{ type: "lesson_finance", id: current.id, lessonId, date: current.date, courseName: current.courseName, status: current.status }],
    confidence: 1,
  });
  await audit(access, "approval_created", "v2_approval", approval?.id || null, { actionType: "finance.receive", lessonId, receivedAmount });
  return Response.json({ approval }, { status: 201 });
}
