export type BillingInput = { studentId: number; status?: string; factor?: number; unitFee?: number; reason?: string };

export const defaultBillingFactor = (status?: string) => status === "half" ? 0.5 : ["leave", "absent"].includes(status || "") ? 0 : 1;

export function calculateLessonFinance(baseFee: number, adjustment: number, items: BillingInput[]) {
  const normalized = items.map((item) => {
    const factor = item.factor == null ? defaultBillingFactor(item.status) : Math.max(0, Number(item.factor));
    const unitFee = Math.max(0, Number(item.unitFee || 0));
    return { ...item, factor, unitFee, amount: roundMoney(factor * unitFee) };
  });
  const expectedAmount = roundMoney(Math.max(0, Number(baseFee || 0)) + Number(adjustment || 0) + normalized.reduce((sum, item) => sum + item.amount, 0));
  return { baseFee: roundMoney(baseFee), adjustment: roundMoney(adjustment), expectedAmount, items: normalized };
}

export function settlementStatus(expected: number, received: number) {
  if (!received) return "pending";
  if (received < expected) return "underpaid";
  if (received > expected) return "overpaid";
  return "settled";
}

export const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

