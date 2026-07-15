import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../lib/access";
import { calculateLessonFinance, settlementStatus } from "../../lib/finance";
import { resolvePricingContext } from "../../lib/finance-rules";

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const p = new URL(request.url).searchParams, from = p.get("from") || "", to = p.get("to") || "", status = p.get("status") || "", lessonId = Number(p.get("lessonId") || 0), where: string[] = [], bind: unknown[] = [];
  if (access.role === "assistant") { where.push("EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=l.class_id AND sca.user_id=?)"); bind.push(access.id); }
  if (from) { where.push("l.date>=?"); bind.push(from); } if (to) { where.push("l.date<=?"); bind.push(to); } if (status) { where.push("lf.status=?"); bind.push(status); } if (lessonId) { const denied = await requireLessonAccess(access, lessonId); if (denied) return denied; where.push("l.id=?"); bind.push(lessonId); }
  const rows = await env.DB.prepare(`SELECT lf.*,lf.pricing_rule_id AS pricingRuleId,lf.calculation_snapshot AS calculationSnapshot,l.id AS lessonId,l.date,l.start_time AS startTime,l.end_time AS endTime,l.location,l.course_name AS courseName,l.topic,i.name AS institutionName FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id LEFT JOIN institutions i ON lf.payer_type='institution' AND i.id=lf.payer_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.date DESC,l.start_time DESC`).bind(...bind).all();
  const totals = await env.DB.prepare(`SELECT COALESCE(SUM(lf.expected_amount),0) AS expected,COALESCE(SUM(lf.received_amount),0) AS received FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).bind(...bind).first();
  return Response.json({ items: rows.results, totals });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, any>, action = String(body.action || "preview"), lessonId = Number(body.lessonId);
  if (!lessonId) return Response.json({ error: "请选择课时" }, { status: 400 });
  const denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  if (action === "receive") { const current = await env.DB.prepare("SELECT id,expected_amount AS expected FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<{ id: number; expected: number }>(); if (!current) return Response.json({ error: "请先确认本节课结算" }, { status: 400 }); const received = Math.max(0, Number(body.receivedAmount || 0)), status = settlementStatus(Number(current.expected), received); await env.DB.prepare("UPDATE lesson_finance SET received_amount=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(received, status, current.id).run(); await audit(access, "receive", "lesson_finance", current.id, { received, status }); return Response.json({ ok: true, status }); }
  if (!['preview','confirm'].includes(action)) return Response.json({ error: "不支持的操作" }, { status: 400 });
  const payerType = body.payerType === "parent" ? "parent" : "institution", payerId = Number(body.payerId || 0) || null, context = await resolvePricingContext(lessonId, payerType, payerId); if (!context) return Response.json({ error: "课时不存在" }, { status: 404 });
  const adjustment = Number(body.adjustment || 0), adjustmentReason = String(body.adjustmentReason || "").trim(); if (adjustment && !adjustmentReason) return Response.json({ error: "使用手工调整金额时必须填写原因" }, { status: 422 });
  const calculation = calculateLessonFinance(context.calculation.baseFee, adjustment, context.calculation.items), snapshot = { rule: context.source, lessonDate: context.lesson.date, payerType, payerId, attendance: context.scopedStudents.map((student) => ({ studentId: student.id, name: student.name, status: student.attendanceStatus, recorded: Boolean(student.attendanceRecorded) })), items: calculation.items, baseFee: calculation.baseFee, adjustment, adjustmentReason, expectedAmount: calculation.expectedAmount, generatedAt: new Date().toISOString() };
  const formula = `规则#${context.rule?.id || "待补"}：底薪 ${calculation.baseFee} + 学生计费 ${calculation.items.reduce((sum, item) => sum + item.amount, 0)} + 调整 ${calculation.adjustment} = ${calculation.expectedAmount}`;
  if (action === "preview") return Response.json({ preview: calculation, formula, context: { source: context.source, exceptions: context.exceptions, canConfirm: context.canConfirm }, snapshot });
  if (!context.canConfirm) return Response.json({ error: "计费规则或出勤记录不完整，不能确认入账", exceptions: context.exceptions }, { status: 422 });
  const existing = await env.DB.prepare("SELECT id,status FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<{ id: number; status: string }>(); if (existing?.status && !["review", "pending"].includes(existing.status)) return Response.json({ error: "已结算账目不能覆盖，请先撤销并记录原因" }, { status: 409 });
  let financeId = existing?.id;
  if (financeId) { await env.DB.prepare("UPDATE lesson_finance SET payer_type=?,payer_id=?,base_fee=?,adjustment=?,expected_amount=?,status='pending',confirmed_at=CURRENT_TIMESTAMP,confirmed_by=?,pricing_rule_id=?,calculation_snapshot=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(payerType, payerId, calculation.baseFee, calculation.adjustment, calculation.expectedAmount, access.id, context.rule?.id || null, JSON.stringify(snapshot), adjustmentReason || null, financeId).run(); await env.DB.prepare("DELETE FROM lesson_billing_items WHERE lesson_finance_id=?").bind(financeId).run(); }
  else { const result = await env.DB.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,status,confirmed_at,confirmed_by,pricing_rule_id,calculation_snapshot,note) VALUES(?,?,?,?,?,?,'pending',CURRENT_TIMESTAMP,?,?,?,?) RETURNING id").bind(lessonId, payerType, payerId, calculation.baseFee, calculation.adjustment, calculation.expectedAmount, access.id, context.rule?.id || null, JSON.stringify(snapshot), adjustmentReason || null).first<{ id: number }>(); financeId = result?.id; }
  if (!financeId) return Response.json({ error: "无法保存结算" }, { status: 500 });
  for (const item of calculation.items) await env.DB.prepare("INSERT INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) VALUES(?,?,?,?,?,?,?)").bind(financeId, item.studentId, item.status || "present", item.factor, item.unitFee, item.amount, item.reason || null).run();
  await audit(access, "confirm", "lesson_finance", financeId, { lessonId, expectedAmount: calculation.expectedAmount, pricingRuleId: context.rule?.id }); return Response.json({ ok: true, id: financeId, calculation, formula, snapshot });
}
