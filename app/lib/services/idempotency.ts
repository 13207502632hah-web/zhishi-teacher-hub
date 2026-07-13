import { env } from "cloudflare:workers";

export type OperationActor = { type: "mini_account" | "user"; id: number };
type OperationStart = { error: Response } | { acquired: true } | { acquired: false; result: Record<string, unknown> };

export async function beginOperation(actor: OperationActor, action: string, operationId: string): Promise<OperationStart> {
  if (!operationId || operationId.length < 8 || operationId.length > 128) {
    return { error: Response.json({ error: "缺少有效的 operationId" }, { status: 400 }) };
  }
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO idempotency_operations(actor_type,actor_id,action,operation_id,status,expires_at) VALUES(?,?,?,?, 'started', datetime('now','+30 day'))")
    .bind(actor.type, actor.id, action, operationId).run();
  if (Number(inserted.meta?.changes || 0) > 0) return { acquired: true };
  const existing = await env.DB.prepare("SELECT status,result_json AS resultJson FROM idempotency_operations WHERE actor_type=? AND actor_id=? AND action=? AND operation_id=?")
    .bind(actor.type, actor.id, action, operationId).first<{ status: string; resultJson: string | null }>();
  if (existing?.status === "completed" && existing.resultJson) {
    return { acquired: false, result: JSON.parse(existing.resultJson) as Record<string, unknown> };
  }
  return { error: Response.json({ error: "相同操作正在处理中，请稍后重试" }, { status: 409 }) };
}

export async function completeOperation(actor: OperationActor, action: string, operationId: string, result: Record<string, unknown>) {
  await env.DB.prepare("UPDATE idempotency_operations SET status='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE actor_type=? AND actor_id=? AND action=? AND operation_id=?")
    .bind(JSON.stringify(result), actor.type, actor.id, action, operationId).run();
}

export async function abandonOperation(actor: OperationActor, action: string, operationId: string) {
  await env.DB.prepare("DELETE FROM idempotency_operations WHERE actor_type=? AND actor_id=? AND action=? AND operation_id=? AND status='started'")
    .bind(actor.type, actor.id, action, operationId).run();
}
