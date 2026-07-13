import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { calculateLessonFinance, settlementStatus } from "../../lib/finance";

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const p = new URL(request.url).searchParams, from = p.get("from") || "", to = p.get("to") || "", status = p.get("status") || "";
  const where: string[] = [], bind: unknown[] = []; if (from) { where.push("l.date>=?"); bind.push(from); } if (to) { where.push("l.date<=?"); bind.push(to); } if (status) { where.push("lf.status=?"); bind.push(status); }
  const rows = await env.DB.prepare(`SELECT lf.*,l.date,l.start_time AS startTime,l.end_time AS endTime,l.location,l.course_name AS courseName,i.name AS institutionName FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id LEFT JOIN institutions i ON lf.payer_type='institution' AND i.id=lf.payer_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.date DESC,l.start_time DESC`).bind(...bind).all();
  const totals = await env.DB.prepare(`SELECT COALESCE(SUM(lf.expected_amount),0) AS expected,COALESCE(SUM(lf.received_amount),0) AS received FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).bind(...bind).first();
  return Response.json({ items: rows.results, totals });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, any>, action = String(body.action || "preview"), lessonId = Number(body.lessonId);
  if (!lessonId) return Response.json({ error: "请选择课时" }, { status: 400 });
  const lesson = await env.DB.prepare("SELECT id,status FROM lessons WHERE id=?").bind(lessonId).first<{ id: number; status: string }>(); if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
  if (action === "receive") { const current = await env.DB.prepare("SELECT id,expected_amount AS expected FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<{ id: number; expected: number }>(); if (!current) return Response.json({ error: "请先确认本节课结算" }, { status: 400 }); const received = Math.max(0, Number(body.receivedAmount || 0)), status = settlementStatus(Number(current.expected), received); await env.DB.prepare("UPDATE lesson_finance SET received_amount=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(received, status, current.id).run(); await audit(access, "receive", "lesson_finance", current.id, { received, status }); return Response.json({ ok: true, status }); }
  const calculation = calculateLessonFinance(Number(body.baseFee || 0), Number(body.adjustment || 0), Array.isArray(body.items) ? body.items : []);
  if (action === "preview") return Response.json({ preview: calculation, formula: `底薪 ${calculation.baseFee} + 学生提成 ${calculation.items.reduce((s, i) => s + i.amount, 0)} + 调整 ${calculation.adjustment} = ${calculation.expectedAmount}` });
  if (action !== "confirm") return Response.json({ error: "不支持的操作" }, { status: 400 });
  const existing = await env.DB.prepare("SELECT id,status FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<{ id: number; status: string }>(); if (existing?.status && !["review", "pending"].includes(existing.status)) return Response.json({ error: "已结算账目不能覆盖，请先撤销并记录原因" }, { status: 409 });
  let financeId = existing?.id; if (financeId) { await env.DB.prepare("UPDATE lesson_finance SET payer_type=?,payer_id=?,base_fee=?,adjustment=?,expected_amount=?,status='pending',confirmed_at=CURRENT_TIMESTAMP,confirmed_by=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.payerType || "institution", body.payerId || null, calculation.baseFee, calculation.adjustment, calculation.expectedAmount, access.id, body.note || null, financeId).run(); await env.DB.prepare("DELETE FROM lesson_billing_items WHERE lesson_finance_id=?").bind(financeId).run(); } else { const result = await env.DB.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,status,confirmed_at,confirmed_by,note) VALUES(?,?,?,?,?,?,'pending',CURRENT_TIMESTAMP,?,?) RETURNING id").bind(lessonId, body.payerType || "institution", body.payerId || null, calculation.baseFee, calculation.adjustment, calculation.expectedAmount, access.id, body.note || null).first<{ id: number }>(); financeId = result?.id; }
  if (!financeId) return Response.json({ error: "无法保存结算" }, { status: 500 }); for (const item of calculation.items) await env.DB.prepare("INSERT INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) VALUES(?,?,?,?,?,?,?)").bind(financeId, item.studentId, item.status || "present", item.factor, item.unitFee, item.amount, item.reason || null).run();
  await audit(access, "confirm", "lesson_finance", financeId, { lessonId, expectedAmount: calculation.expectedAmount }); return Response.json({ ok: true, id: financeId, calculation });
}

