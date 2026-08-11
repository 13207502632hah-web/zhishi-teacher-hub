import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";
import { calculateLessonFinance } from "../../../../lib/finance";
import { previewFingerprint } from "../../../../lib/finance-preview";
import { resolvePricingContext } from "../../../../lib/finance-rules";
import { createApproval } from "../../../../lib/v2/approval-service";

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>, lessonId = Number(body.lessonId || 0), payerType = String(body.payerType || "");
  if (!Number.isInteger(lessonId) || lessonId <= 0) return Response.json({ error: "请选择有效课时" }, { status: 400 });
  const denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  if (!["institution", "parent"].includes(payerType)) return Response.json({ error: "付款方类型无效" }, { status: 400 });
  const payerId = body.payerId == null || body.payerId === "" ? null : Number(body.payerId), adjustment = Number(body.adjustment || 0), adjustmentReason = String(body.adjustmentReason || "").trim();
  if (payerId !== null && (!Number.isInteger(payerId) || payerId <= 0)) return Response.json({ error: "付款方编号无效" }, { status: 400 });
  if (!Number.isFinite(adjustment)) return Response.json({ error: "调整金额无效" }, { status: 400 });
  if (adjustment !== 0 && !adjustmentReason) return Response.json({ error: "调整金额不为 0 时必须填写原因" }, { status: 422 });
  const context = await resolvePricingContext(lessonId, payerType, payerId); if (!context) return Response.json({ error: "课时不存在" }, { status: 404 });
  const calculation = calculateLessonFinance(context.calculation.baseFee, adjustment, context.calculation.items), fingerprint = await previewFingerprint({ lessonId, lessonDate: context.lesson.date, payerType, payerId, ruleId: context.rule?.id || null, calculation });
  if (!context.canConfirm) return Response.json({ error: "计费规则或出勤记录不完整，不能提交确认", exceptions: context.exceptions, preview: calculation }, { status: 422 });
  const operationId = crypto.randomUUID(), formula = `规则#${context.rule?.id || "待补"}：底薪 ${calculation.baseFee} + 学生计费 ${calculation.items.reduce((sum, item) => sum + item.amount, 0)} + 调整 ${calculation.adjustment} = ${calculation.expectedAmount}`;
  const snapshot = { rule: context.source, lessonDate: context.lesson.date, payerType, payerId, attendance: context.scopedStudents.map((student) => ({ studentId: student.id, name: student.name, status: student.attendanceStatus, recorded: Boolean(student.attendanceRecorded) })), items: calculation.items, baseFee: calculation.baseFee, adjustment, adjustmentReason, expectedAmount: calculation.expectedAmount, fingerprint, operationId, generatedAt: new Date().toISOString() };
  const approval = await createApproval(access, { actionType: "finance.confirm", entityType: "lesson_finance", entityId: String(lessonId), title: `确认课时结算：${context.lesson.courseName}`, summary: formula, payload: { lessonId, payerType, payerId, adjustment, adjustmentReason, calculation, ruleId: context.rule?.id || null, fingerprint, operationId, formula, snapshot }, evidence: [{ type: "lesson", id: lessonId, date: context.lesson.date, courseName: context.lesson.courseName }, ...context.scopedStudents.map((student) => ({ type: "attendance", studentId: student.id, name: student.name, status: student.attendanceStatus }))] });
  await audit(access, "approval_created", "v2_approval", approval?.id || null, { actionType: "finance.confirm", lessonId, expectedAmount: calculation.expectedAmount });
  return Response.json({ approval, preview: calculation, formula }, { status: 201 });
}
