import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../lib/access";
import { confirmFinanceSettlement } from "../../lib/finance-confirm";
import { calculateLessonFinance, settlementStatus } from "../../lib/finance";
import { resolvePricingContext } from "../../lib/finance-rules";
import { createPreviewToken, previewFingerprint, readPreviewToken } from "../../lib/finance-preview";

type Row = Record<string, any>;

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseRequiredNumber = (value: unknown, label: string) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return { value: null as number | null, error: `${label}不能为空` };
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { value: parsed, error: "" } : { value: null as number | null, error: `${label}必须是有效数字` };
};

const parseOptionalId = (value: unknown) => {
  if (value === null || value === undefined || value === "") return { value: null as number | null, error: "" };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? { value: parsed, error: "" } : { value: null as number | null, error: "付款方编号无效" };
};

const invalidJson = () => Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const p = new URL(request.url).searchParams, from = p.get("from") || "", to = p.get("to") || "", status = p.get("status") || "", lessonId = Number(p.get("lessonId") || 0), where: string[] = [], bind: unknown[] = [];
  if (access.role === "assistant") { where.push("EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=l.class_id AND sca.user_id=?)"); bind.push(access.id); }
  if (from) { where.push("l.date>=?"); bind.push(from); } if (to) { where.push("l.date<=?"); bind.push(to); } if (status) { where.push("lf.status=?"); bind.push(status); } if (lessonId) { const denied = await requireLessonAccess(access, lessonId); if (denied) return denied; where.push("l.id=?"); bind.push(lessonId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DB.prepare(`SELECT lf.*,lf.pricing_rule_id AS pricingRuleId,lf.calculation_snapshot AS calculationSnapshot,lf.expected_amount AS expectedAmount,lf.received_amount AS receivedAmount,l.id AS lessonId,l.date,l.start_time AS startTime,l.end_time AS endTime,l.location,l.course_name AS courseName,l.topic,i.name AS institutionName FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id LEFT JOIN institutions i ON lf.payer_type='institution' AND i.id=lf.payer_id ${whereSql} ORDER BY l.date DESC,l.start_time DESC`).bind(...bind).all<Row>();
  const totals = await env.DB.prepare(`SELECT COALESCE(SUM(lf.expected_amount),0) AS expected,COALESCE(SUM(lf.received_amount),0) AS received,COALESCE(SUM(CASE WHEN lf.status='pending' AND lf.expected_amount>lf.received_amount THEN lf.expected_amount-lf.received_amount ELSE 0 END),0) AS pendingAmount,COALESCE(SUM(CASE WHEN lf.status='underpaid' AND lf.expected_amount>lf.received_amount THEN lf.expected_amount-lf.received_amount ELSE 0 END),0) AS underpaidAmount,COALESCE(SUM(CASE WHEN lf.status='overpaid' AND lf.received_amount>lf.expected_amount THEN lf.received_amount-lf.expected_amount ELSE 0 END),0) AS overpaidAmount,COALESCE(SUM(CASE WHEN lf.status='review' THEN lf.expected_amount ELSE 0 END),0) AS reviewAmount FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id ${whereSql}`).bind(...bind).first<Row>();
  const items = rows.results.map((row) => {
    const expectedAmount = numberOrNull(row.expectedAmount), receivedAmount = numberOrNull(row.receivedAmount);
    return { ...row, expectedAmount, receivedAmount, difference: expectedAmount === null || receivedAmount === null ? null : receivedAmount - expectedAmount };
  });
  return Response.json({ items, totals });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json().catch(() => null) as Record<string, any> | null; if (!body || typeof body !== "object" || Array.isArray(body)) return invalidJson();
  const action = String(body.action || "preview"), lessonId = Number(body.lessonId);
  if (!Number.isInteger(lessonId) || lessonId <= 0) return Response.json({ error: "请选择有效课时" }, { status: 400 });
  const denied = await requireLessonAccess(access, lessonId); if (denied) return denied;

  if (action === "receive") {
    const current = await env.DB.prepare("SELECT id,expected_amount AS expected,confirmed_at AS confirmedAt FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<{ id: number; expected: number; confirmedAt: string | null }>();
    if (!current || !current.confirmedAt) return Response.json({ error: "请先确认本节课结算" }, { status: 400 });
    const receivedResult = parseRequiredNumber(body.receivedAmount, "实收金额");
    if (receivedResult.error) return Response.json({ error: receivedResult.error }, { status: 400 });
    if ((receivedResult.value as number) < 0) return Response.json({ error: "实收金额不能为负数" }, { status: 422 });
    const received = receivedResult.value as number, status = settlementStatus(Number(current.expected), received);
    await env.DB.prepare("UPDATE lesson_finance SET received_amount=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND confirmed_at IS NOT NULL").bind(received, status, current.id).run();
    await audit(access, "receive", "lesson_finance", current.id, { received, status });
    return Response.json({ ok: true, status });
  }

  if (!["preview", "confirm"].includes(action)) return Response.json({ error: "不支持的操作" }, { status: 400 });
  const operationId = String(body.operationId || "").trim();
  if (!operationId) return Response.json({ error: "缺少操作编号，请重新提交" }, { status: 400 });
  if (!["institution", "parent"].includes(String(body.payerType))) return Response.json({ error: "付款方类型无效" }, { status: 400 });
  const payerType = body.payerType as "institution" | "parent", payerIdResult = parseOptionalId(body.payerId);
  if (payerIdResult.error) return Response.json({ error: payerIdResult.error }, { status: 400 });
  const payerId = payerIdResult.value, adjustmentResult = parseRequiredNumber(body.adjustment, "手工调整金额");
  if (adjustmentResult.error) return Response.json({ error: adjustmentResult.error }, { status: 400 });
  const adjustment = adjustmentResult.value as number, adjustmentReason = String(body.adjustmentReason || "").trim();
  if (adjustment !== 0 && !adjustmentReason) return Response.json({ error: "使用手工调整金额时必须填写原因" }, { status: 422 });
  const context = await resolvePricingContext(lessonId, payerType, payerId); if (!context) return Response.json({ error: "课时不存在" }, { status: 404 });
  const calculation = calculateLessonFinance(context.calculation.baseFee, adjustment, context.calculation.items), fingerprint = await previewFingerprint({ lessonId, lessonDate: context.lesson.date, payerType, payerId, ruleId: context.rule?.id || null, calculation });
  const snapshot = { rule: context.source, lessonDate: context.lesson.date, payerType, payerId, attendance: context.scopedStudents.map((student) => ({ studentId: student.id, name: student.name, status: student.attendanceStatus, recorded: Boolean(student.attendanceRecorded) })), items: calculation.items, baseFee: calculation.baseFee, adjustment, adjustmentReason, expectedAmount: calculation.expectedAmount, fingerprint, operationId, generatedAt: new Date().toISOString() };
  const formula = `规则#${context.rule?.id || "待补"}：底薪 ${calculation.baseFee} + 学生计费 ${calculation.items.reduce((sum, item) => sum + item.amount, 0)} + 调整 ${calculation.adjustment} = ${calculation.expectedAmount}`;

  if (action === "preview") {
    const token = await createPreviewToken({ actorId: access.id, lessonId, payerType, payerId, adjustment, adjustmentReason, fingerprint, operationId });
    if (!token) return Response.json({ error: "无法建立安全预览边界，请联系管理员配置会话密钥" }, { status: 503 });
    return Response.json({ preview: calculation, formula, context: { source: context.source, exceptions: context.exceptions, canConfirm: context.canConfirm }, snapshot, previewToken: token.token, expiresAt: token.expiresAt });
  }

  const previewToken = await readPreviewToken(body.previewToken);
  if (!previewToken || previewToken.actorId !== access.id || previewToken.lessonId !== lessonId || previewToken.payerType !== payerType || previewToken.payerId !== payerId || previewToken.adjustment !== adjustment || previewToken.adjustmentReason !== adjustmentReason || previewToken.fingerprint !== fingerprint || previewToken.operationId !== operationId) return Response.json({ error: "预览已失效或内容已变化，请重新生成预览" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  if (!context.canConfirm) return Response.json({ error: "计费规则或出勤记录不完整，不能确认入账", exceptions: context.exceptions }, { status: 422 });

  return confirmFinanceSettlement({
    actor: { type: "user", id: access.id },
    lessonId,
    payerType,
    payerId,
    adjustment,
    adjustmentReason,
    calculation,
    ruleId: context.rule?.id || null,
    fingerprint,
    operationId,
    formula,
    snapshot,
  });
}
