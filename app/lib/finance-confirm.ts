import { env } from "cloudflare:workers";
import type { BillingInput } from "./finance";
import { abandonOperation, beginOperation, completeOperation, type OperationActor } from "./services/idempotency";

type FinanceCalculation = {
  baseFee: number;
  adjustment: number;
  expectedAmount: number;
  items: Array<BillingInput & { factor: number; unitFee: number; amount: number }>;
};

export type FinanceConfirmInput = {
  actor: OperationActor;
  lessonId: number;
  payerType: "institution" | "parent";
  payerId: number | null;
  adjustment: number;
  adjustmentReason: string;
  calculation: FinanceCalculation;
  ruleId: number | null;
  fingerprint: string;
  operationId: string;
  formula: string;
  snapshot: Record<string, unknown>;
};

const parseStoredJson = (value: string | null): Record<string, unknown> | null => {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

async function completeOperationBestEffort(
  input: FinanceConfirmInput,
  result: Record<string, unknown>,
) {
  try {
    await completeOperation(input.actor, "finance.confirm", input.operationId, result);
  } catch {
    // 业务账目已经提交；幂等记录补写失败时由下一次 replay 恢复。
  }
}

async function replayCommittedFinance(input: FinanceConfirmInput): Promise<Response | null> {
  const operation = await env.DB.prepare("SELECT status FROM idempotency_operations WHERE actor_type=? AND actor_id=? AND action=? AND operation_id=?")
    .bind(input.actor.type, input.actor.id, "finance.confirm", input.operationId)
    .first<{ status: string }>();
  if (!operation || operation.status !== "started") return null;
  const row = await env.DB.prepare("SELECT id, calculation_snapshot AS snapshot FROM lesson_finance WHERE lesson_id=? AND status='pending' AND confirmed_by=? AND confirmed_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    .bind(input.lessonId, input.actor.id)
    .first<{ id: number; snapshot: string | null }>();
  if (!row?.id) return null;
  const saved = parseStoredJson(row.snapshot);
  if (!saved || saved.operationId !== input.operationId || saved.fingerprint !== input.fingerprint) return null;
  const result = {
    ok: true,
    id: Number(row.id),
    lessonId: input.lessonId,
    fingerprint: input.fingerprint,
    calculation: input.calculation,
    formula: input.formula,
    snapshot: saved,
    replayed: true,
  };
  await completeOperationBestEffort(input, result);
  return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function confirmFinanceSettlement(input: FinanceConfirmInput) {
  const operation = await beginOperation(input.actor, "finance.confirm", input.operationId);
  if ("error" in operation) {
    return (await replayCommittedFinance(input)) || operation.error;
  }
  if (!operation.acquired) {
    const replay = operation.result as { lessonId?: unknown; fingerprint?: unknown };
    if (Number(replay.lessonId) !== input.lessonId || replay.fingerprint !== input.fingerprint) {
      return Response.json({ error: "操作编号已被其他结算内容占用，请刷新后重新确认", code: "operation_replay_conflict" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ...operation.result, replayed: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  const committedReplay = await replayCommittedFinance(input);
  if (committedReplay) return committedReplay;

  let batchCommitted = false;
  try {
    const existing = await env.DB.prepare("SELECT id,status,confirmed_at AS confirmedAt FROM lesson_finance WHERE lesson_id=?").bind(input.lessonId).first<{ id: number; status: string; confirmedAt: string | null }>();
    if (existing?.status && (existing.status !== "review" || existing.confirmedAt)) {
      await abandonOperation(input.actor, "finance.confirm", input.operationId);
      return Response.json({ error: "本节课已有确认账目，不能重复确认或覆盖", code: "already_confirmed" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const confirmedAt = new Date().toISOString();
    const confirmedSnapshot = { ...input.snapshot, confirmedAt, confirmedBy: input.actor.id };
    const snapshotText = JSON.stringify(confirmedSnapshot);
    const selector = "SELECT id FROM lesson_finance WHERE lesson_id=? AND status='pending' AND confirmed_by=? AND calculation_snapshot=? AND confirmed_at=?";
    const statements: D1PreparedStatement[] = [];
    if (existing?.id) {
      statements.push(env.DB.prepare("UPDATE lesson_finance SET payer_type=?,payer_id=?,base_fee=?,adjustment=?,expected_amount=?,status='pending',confirmed_at=?,confirmed_by=?,pricing_rule_id=?,calculation_snapshot=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='review' AND confirmed_at IS NULL")
        .bind(input.payerType, input.payerId, input.calculation.baseFee, input.calculation.adjustment, input.calculation.expectedAmount, confirmedAt, input.actor.id, input.ruleId, snapshotText, input.adjustmentReason || null, existing.id));
    } else {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,status,confirmed_at,confirmed_by,pricing_rule_id,calculation_snapshot,note) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?)")
        .bind(input.lessonId, input.payerType, input.payerId, input.calculation.baseFee, input.calculation.adjustment, input.calculation.expectedAmount, confirmedAt, input.actor.id, input.ruleId, snapshotText, input.adjustmentReason || null));
    }
    statements.push(env.DB.prepare(`DELETE FROM lesson_billing_items WHERE lesson_finance_id IN (${selector})`).bind(input.lessonId, input.actor.id, snapshotText, confirmedAt));
    for (const item of input.calculation.items) {
      statements.push(env.DB.prepare(`INSERT INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) SELECT id,?,?,?,?,?,? FROM lesson_finance WHERE lesson_id=? AND status='pending' AND confirmed_by=? AND calculation_snapshot=? AND confirmed_at=?`)
        .bind(item.studentId, item.status || "present", item.factor, item.unitFee, item.amount, item.reason || null, input.lessonId, input.actor.id, snapshotText, confirmedAt));
    }
    statements.push(env.DB.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) SELECT ?,?,?,CAST(id AS TEXT),? FROM lesson_finance WHERE lesson_id=? AND status='pending' AND confirmed_by=? AND calculation_snapshot=? AND confirmed_at=?`)
      .bind(input.actor.id, "confirm", "lesson_finance", JSON.stringify({ lessonId: input.lessonId, expectedAmount: input.calculation.expectedAmount, pricingRuleId: input.ruleId, operationId: input.operationId }), input.lessonId, input.actor.id, snapshotText, confirmedAt));

    const results = await env.DB.batch(statements);
    batchCommitted = true;
    if (Number(results[0]?.meta?.changes || 0) < 1) {
      await abandonOperation(input.actor, "finance.confirm", input.operationId);
      return Response.json({ error: "确认请求重复或账目状态已变化，未写入新的账目", code: "confirm_conflict" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const saved = await env.DB.prepare("SELECT id FROM lesson_finance WHERE lesson_id=? AND status='pending' AND confirmed_by=? AND calculation_snapshot=?").bind(input.lessonId, input.actor.id, snapshotText).first<{ id: number }>();
    if (!saved?.id) {
      return Response.json({ error: "账目已写入但结算记录读取失败，请使用同一操作重试", code: "confirm_write_pending" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
    const result = { ok: true, id: saved.id, lessonId: input.lessonId, fingerprint: input.fingerprint, calculation: input.calculation, formula: input.formula, snapshot: confirmedSnapshot, replayed: false };
    await completeOperationBestEffort(input, result);
    return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    if (!batchCommitted) {
      await abandonOperation(input.actor, "finance.confirm", input.operationId);
      return Response.json({ error: "确认入账未完成，系统已回滚本次账目写入，请保留预览后重试" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "账目已写入但确认流程中断，请使用同一操作重试", code: "confirm_write_pending" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
