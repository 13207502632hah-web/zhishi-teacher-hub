import { env } from "cloudflare:workers";
import { isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";

type Row = Record<string, unknown>;

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, from = params.get("from") || "", to = params.get("to") || "", status = params.get("status") || "", lessonId = Number(params.get("lessonId") || 0), where: string[] = [], bind: unknown[] = [];
  if (from) { where.push("l.date>=?"); bind.push(from); }
  if (to) { where.push("l.date<=?"); bind.push(to); }
  if (status) { where.push("lf.status=?"); bind.push(status); }
  if (lessonId) { const denied = await requireLessonAccess(access, lessonId); if (denied) return denied; where.push("l.id=?"); bind.push(lessonId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DB.prepare(`SELECT lf.*,lf.pricing_rule_id AS pricingRuleId,lf.calculation_snapshot AS calculationSnapshot,lf.expected_amount AS expectedAmount,lf.received_amount AS receivedAmount,l.id AS lessonId,l.date,l.start_time AS startTime,l.end_time AS endTime,l.location,l.course_name AS courseName,l.topic,i.name AS institutionName FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id LEFT JOIN institutions i ON lf.payer_type='institution' AND i.id=lf.payer_id ${whereSql} ORDER BY l.date DESC,l.start_time DESC`).bind(...bind).all<Row>();
  const totals = await env.DB.prepare(`SELECT COALESCE(SUM(lf.expected_amount),0) AS expected,COALESCE(SUM(lf.received_amount),0) AS received,COALESCE(SUM(CASE WHEN lf.status='pending' AND lf.expected_amount>lf.received_amount THEN lf.expected_amount-lf.received_amount ELSE 0 END),0) AS pendingAmount,COALESCE(SUM(CASE WHEN lf.status='underpaid' AND lf.expected_amount>lf.received_amount THEN lf.expected_amount-lf.received_amount ELSE 0 END),0) AS underpaidAmount,COALESCE(SUM(CASE WHEN lf.status='overpaid' AND lf.received_amount>lf.expected_amount THEN lf.received_amount-lf.expected_amount ELSE 0 END),0) AS overpaidAmount,COALESCE(SUM(CASE WHEN lf.status='review' THEN lf.expected_amount ELSE 0 END),0) AS reviewAmount FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id ${whereSql}`).bind(...bind).first<Row>();
  const items = rows.results.map((row) => { const expectedAmount = numberOrNull(row.expectedAmount), receivedAmount = numberOrNull(row.receivedAmount); return { ...row, expectedAmount, receivedAmount, difference: expectedAmount === null || receivedAmount === null ? null : receivedAmount - expectedAmount }; });
  return Response.json({ items, totals });
}
