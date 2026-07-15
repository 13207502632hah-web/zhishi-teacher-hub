import { env } from "cloudflare:workers";
import type { AccessContext } from "./access";

export async function monthlyFinance(month: string, access: AccessContext) {
  const currentMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()), safeMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : currentMonth;
  const start = `${safeMonth}-01`, value = new Date(`${start}T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + 1); value.setUTCDate(0); const end = value.toISOString().slice(0, 10), scope = access.role === "assistant" ? " AND EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=l.class_id AND sca.user_id=?)" : "";
  const rows = await env.DB.prepare(`SELECT l.id AS lessonId,l.date,l.start_time AS startTime,l.course_name AS courseName,l.topic,l.status AS lessonStatus,c.name AS className,lf.id AS financeId,lf.payer_type AS payerType,lf.payer_id AS payerId,lf.base_fee AS baseFee,lf.adjustment,lf.expected_amount AS expectedAmount,lf.received_amount AS receivedAmount,lf.status AS financeStatus,lf.pricing_rule_id AS pricingRuleId,lf.calculation_snapshot AS calculationSnapshot,lf.note,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=l.class_id AND e.status='active') AS memberCount,(SELECT COUNT(*) FROM attendance a WHERE a.lesson_id=l.id) AS attendanceCount,(SELECT COUNT(*) FROM attendance a WHERE a.lesson_id=l.id AND a.status IN ('late','absent','leave')) AS attendanceExceptions,COALESCE((SELECT SUM(amount) FROM lesson_billing_items bi WHERE bi.lesson_finance_id=lf.id),0) AS itemAmount FROM lessons l LEFT JOIN classes c ON c.id=l.class_id LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id WHERE l.date BETWEEN ? AND ? AND l.status!='cancelled'${scope} ORDER BY l.date,l.start_time,l.id`).bind(start, end, ...(access.role === "assistant" ? [access.id] : [])).all<Record<string, any>>();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const items: Array<Record<string, any> & {
    calculated: number;
    difference: number;
    exceptions: string[];
    lifecycle: string;
  }> = rows.results.map((row) => {
    const exceptions: string[] = [], calculated = Number(row.baseFee || 0) + Number(row.itemAmount || 0) + Number(row.adjustment || 0);
    if (Number(row.memberCount || 0) > Number(row.attendanceCount || 0) && row.date <= today) exceptions.push("出勤登记不完整");
    if (Number(row.attendanceExceptions || 0) > 0) exceptions.push(`${row.attendanceExceptions}人次出勤例外`);
    if (!row.pricingRuleId && row.date <= today) exceptions.push("缺计费规则来源");
    if (!row.financeId && row.date <= today) exceptions.push("尚未生成结算");
    if (Number(row.adjustment || 0) !== 0) exceptions.push(`手工调整${Number(row.adjustment).toFixed(2)}元`);
    if (row.financeId && Math.abs(calculated - Number(row.expectedAmount || 0)) > .01) exceptions.push("计算明细与总额不一致");
    if (row.financeStatus === "underpaid") exceptions.push("少收"); if (row.financeStatus === "overpaid") exceptions.push("超收"); if (row.financeStatus === "review") exceptions.push("待确认");
    return { ...row, calculated, difference: Number(row.receivedAmount || 0) - Number(row.expectedAmount || 0), exceptions, lifecycle: row.date > today ? "未来未到期" : row.lessonStatus === "completed" ? "已完成" : "待完成" };
  });
  const summary = { lessons: items.length, completed: items.filter((item) => item.lifecycle === "已完成").length, future: items.filter((item) => item.lifecycle === "未来未到期").length, exceptions: items.filter((item) => item.exceptions.length).length, expected: items.reduce((sum, item) => sum + Number(item.expectedAmount || 0), 0), received: items.reduce((sum, item) => sum + Number(item.receivedAmount || 0), 0) };
  return { month: safeMonth, range: { start, end }, summary, items };
}
