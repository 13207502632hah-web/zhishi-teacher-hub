export const explicitAttendanceStatuses = ["present", "late", "absent", "leave"] as const;

export type AttendanceStatus = typeof explicitAttendanceStatuses[number];
export type CompletionRecord = { studentId: number; attendanceStatus?: string };

export function validateLessonCompletion(actualContent: unknown, memberIds: number[], records: CompletionRecord[]) {
  const errors: string[] = [];
  if (!String(actualContent || "").trim()) errors.push("请填写实际教学内容");
  const byStudent = new Map(records.map((record) => [Number(record.studentId), String(record.attendanceStatus || "")]));
  const missing = memberIds.filter((studentId) => !explicitAttendanceStatuses.includes(byStudent.get(studentId) as AttendanceStatus));
  if (missing.length) errors.push(`请确认全部学生出勤（还差 ${missing.length} 人）`);
  return errors;
}

export function completionTodos(input: { assignment?: boolean; feedback?: boolean; nextPlan?: unknown }) {
  const todos: string[] = [];
  if (!input.assignment) todos.push("补充课后作业");
  if (!input.feedback) todos.push("补充课程反馈");
  if (!String(input.nextPlan || "").trim()) todos.push("补充下节课计划");
  return todos;
}

export function attendanceFactor(status?: string) {
  return ["absent", "leave"].includes(String(status || "")) ? 0 : 1;
}

type FinanceRule = {
  id?: number;
  institutionId?: number | null;
  studentId?: number | null;
  payerType?: string;
  baseFee?: number;
  perStudentFee?: number;
  unitPrice?: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

type FinanceMember = { studentId: number; attendanceStatus?: string };

export type FinancePlan = {
  payerType: "institution" | "parent";
  payerId: number | null;
  baseFee: number;
  expectedAmount: number;
  note: string;
  source: "schedule_import" | "pricing_rule" | "existing_review" | "lesson_fee" | "missing_rule";
  items: Array<{ studentId: number; status: string; factor: number; unitFee: number; amount: number }>;
};

const money = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const activeOn = (rule: FinanceRule, date: string) => (!rule.effectiveFrom || rule.effectiveFrom <= date) && (!rule.effectiveTo || rule.effectiveTo >= date);

export function resolveLessonFinance(input: {
  date: string;
  lessonFee?: number | null;
  imported?: Record<string, unknown> | null;
  existing?: { payerType?: string; payerId?: number | null; baseFee?: number; expectedAmount?: number } | null;
  rules?: FinanceRule[];
  members: FinanceMember[];
}): FinancePlan {
  const imported = input.imported || {};
  const importBase = money(imported.baseFee);
  const importUnit = money(imported.perStudentFee);
  const importFee = money(imported.fee);
  const hasImportPricing = Boolean(importBase || importUnit || importFee || String(imported.institution || "").trim());
  let payerType: "institution" | "parent" = input.existing?.payerType === "institution" || String(imported.institution || "").trim() ? "institution" : "parent";
  let payerId = input.existing?.payerId == null ? null : Number(input.existing.payerId);
  let baseFee = 0;
  let source: FinancePlan["source"] = "missing_rule";
  let note = "计费规则待补";
  const unitFees = new Map<number, number>();

  if (hasImportPricing) {
    source = "schedule_import";
    baseFee = importBase || (importUnit ? 0 : importFee);
    for (const member of input.members) unitFees.set(member.studentId, importUnit);
    note = "根据课表导入费用生成，待教师核对";
  } else {
    const rules = (input.rules || []).filter((rule) => activeOn(rule, input.date));
    const sorted = [...rules].sort((left, right) => String(right.effectiveFrom || "").localeCompare(String(left.effectiveFrom || "")) || Number(right.id || 0) - Number(left.id || 0));
    const selectedByMember = input.members.map((member) => sorted.find((rule) => Number(rule.studentId || 0) === member.studentId)
      || sorted.find((rule) => !rule.studentId && input.existing?.payerId && Number(rule.institutionId || 0) === Number(input.existing.payerId))
      || sorted.find((rule) => !rule.studentId && !rule.institutionId));
    const selected = selectedByMember.filter(Boolean) as FinanceRule[];
    if (selected.length) {
      source = "pricing_rule";
      baseFee = money(Math.max(...selected.map((rule) => Number(rule.baseFee || 0))));
      selectedByMember.forEach((rule, index) => {
        const member = input.members[index];
        if (member && rule) unitFees.set(member.studentId, money(rule.unitPrice || rule.perStudentFee));
      });
      const payerRule = selected.find((rule) => rule.payerType === "institution") || selected[0];
      payerType = payerRule.payerType === "institution" ? "institution" : "parent";
      payerId = payerRule.institutionId == null ? payerId : Number(payerRule.institutionId);
      note = "根据有效计费规则生成，待教师核对";
    } else if (Number(input.existing?.baseFee || input.existing?.expectedAmount || 0) > 0) {
      source = "existing_review";
      baseFee = money(input.existing?.baseFee || input.existing?.expectedAmount);
      note = "沿用原待核对金额，请教师复核";
    } else if (Number(input.lessonFee || 0) > 0) {
      source = "lesson_fee";
      baseFee = money(input.lessonFee);
      note = "根据课时费用生成，待教师核对";
    }
  }

  const items = input.members.map((member) => {
    const factor = attendanceFactor(member.attendanceStatus);
    const unitFee = money(unitFees.get(member.studentId) || 0);
    return { studentId: member.studentId, status: String(member.attendanceStatus || "present"), factor, unitFee, amount: money(factor * unitFee) };
  });
  return { payerType, payerId, baseFee: money(baseFee), expectedAmount: money(baseFee + items.reduce((sum, item) => sum + item.amount, 0)), note, source, items };
}
