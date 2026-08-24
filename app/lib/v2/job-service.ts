import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { isJobState, parseJsonObject, type JobState, type JsonObject, type V2Job } from "./contracts";

type CreateJobInput = {
  type: string;
  operationId: string;
  entityType?: string;
  entityId?: string | number;
  total?: number;
  payload?: JsonObject;
  state?: JobState;
  stage?: string;
};

const rowToJob = (row: Record<string, unknown>): V2Job => ({
  id: String(row.id),
  type: String(row.type),
  state: isJobState(row.state) ? row.state : "failed",
  stage: String(row.stage || "queued"),
  progress: Number(row.progress || 0),
  processed: Number(row.processed || 0),
  total: Number(row.total || 0),
  result: parseJsonObject(row.resultJson),
  checkpoint: parseJsonObject(row.checkpointJson),
  error: parseJsonObject(row.errorJson),
  cancelRequested: Boolean(row.cancelRequested),
  createdAt: String(row.createdAt || ""),
  updatedAt: String(row.updatedAt || ""),
});

export async function createJob(access: AccessContext, input: CreateJobInput) {
  const id = crypto.randomUUID();
  const existing = await env.DB.prepare("SELECT id,type,state,stage,progress,processed,total,result_json AS resultJson,checkpoint_json AS checkpointJson,error_json AS errorJson,cancel_requested AS cancelRequested,created_at AS createdAt,updated_at AS updatedAt FROM v2_jobs WHERE user_id=? AND type=? AND operation_id=?")
    .bind(access.id, input.type, input.operationId).first<Record<string, unknown>>();
  if (existing) return { job: rowToJob(existing), repeated: true };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO v2_jobs(id,user_id,type,entity_type,entity_id,state,stage,total,payload_json,operation_id,available_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(id, access.id, input.type, input.entityType || null, input.entityId == null ? null : String(input.entityId), input.state || "queued", input.stage || "queued", input.total || 0, JSON.stringify(input.payload || {}), input.operationId),
    env.DB.prepare("INSERT INTO v2_job_events(job_id,state,stage,progress,message) VALUES(?,?,?,?,?)")
      .bind(id, input.state || "queued", input.stage || "queued", 0, "任务已创建"),
  ]);
  return { job: await getJob(access, id) as V2Job, repeated: false };
}

export async function getJob(access: AccessContext, id: string) {
  const row = await env.DB.prepare(`SELECT id,type,state,stage,progress,processed,total,result_json AS resultJson,checkpoint_json AS checkpointJson,error_json AS errorJson,cancel_requested AS cancelRequested,created_at AS createdAt,updated_at AS updatedAt FROM v2_jobs WHERE id=?${access.role === "teacher" ? "" : " AND user_id=?"}`)
    .bind(id, ...(access.role === "teacher" ? [] : [access.id])).first<Record<string, unknown>>();
  return row ? rowToJob(row) : null;
}

export async function listJobs(access: AccessContext, options: { type?: string; state?: string; limit?: number } = {}) {
  const conditions = access.role === "teacher" ? ["1=1"] : ["user_id=?"], bindings: unknown[] = access.role === "teacher" ? [] : [access.id];
  if (options.type) { conditions.push("type=?"); bindings.push(options.type); }
  if (options.state && isJobState(options.state)) { conditions.push("state=?"); bindings.push(options.state); }
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30)));
  const rows = await env.DB.prepare(`SELECT id,type,state,stage,progress,processed,total,result_json AS resultJson,checkpoint_json AS checkpointJson,error_json AS errorJson,cancel_requested AS cancelRequested,created_at AS createdAt,updated_at AS updatedAt FROM v2_jobs WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...bindings, limit).all<Record<string, unknown>>();
  return rows.results.map(rowToJob);
}

export async function updateJob(access: AccessContext, id: string, update: { state: JobState; stage: string; progress?: number; processed?: number; total?: number; result?: JsonObject; checkpoint?: JsonObject; error?: JsonObject; message?: string }) {
  const current = await getJob(access, id);
  if (!current) return null;
  const progress = Math.max(0, Math.min(100, Math.round(update.progress ?? current.progress)));
  await env.DB.batch([
    env.DB.prepare("UPDATE v2_jobs SET state=?,stage=?,progress=?,processed=?,total=?,result_json=?,checkpoint_json=?,error_json=?,lease_owner=CASE WHEN ? IN ('queued','running') THEN lease_owner ELSE NULL END,lease_until=CASE WHEN ? IN ('queued','running') THEN lease_until ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
      .bind(update.state, update.stage, progress, update.processed ?? current.processed, update.total ?? current.total, JSON.stringify(update.result ?? current.result), JSON.stringify(update.checkpoint ?? current.checkpoint), JSON.stringify(update.error ?? current.error), update.state, update.state, id, access.id),
    env.DB.prepare("INSERT INTO v2_job_events(job_id,state,stage,progress,message,detail_json) VALUES(?,?,?,?,?,?)")
      .bind(id, update.state, update.stage, progress, update.message || null, JSON.stringify(update.error || update.result || {})),
  ]);
  return getJob(access, id);
}

export async function requestJobCancel(access: AccessContext, id: string) {
  const result = await env.DB.prepare("UPDATE v2_jobs SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,stage=CASE WHEN state='queued' THEN 'cancelled' ELSE stage END,lease_owner=CASE WHEN state='queued' THEN NULL ELSE lease_owner END,lease_until=CASE WHEN state='queued' THEN NULL ELSE lease_until END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND state IN ('queued','running','waiting_review','partial')")
    .bind(id, access.id).run();
  return Number(result.meta?.changes || 0) === 1;
}

export type BackgroundJobClaim = { id: string; userId: number; type: string; entityId: string | null; payload: JsonObject; attemptCount: number; maxAttempts: number };

export async function claimBackgroundJob(id: string, leaseOwner: string, leaseSeconds = 45) {
  const row = await env.DB.prepare("UPDATE v2_jobs SET state='running',stage=CASE WHEN stage IN ('queued','retry_queued') THEN 'claimed' ELSE stage END,attempt_count=attempt_count+1,lease_owner=?,lease_until=datetime('now',? || ' seconds'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND cancel_requested=0 AND attempt_count<max_attempts AND datetime(COALESCE(available_at,created_at))<=datetime('now') AND (state='queued' OR (state='running' AND datetime(COALESCE(lease_until,'1970-01-01'))<=datetime('now'))) RETURNING id,user_id AS userId,type,entity_id AS entityId,payload_json AS payloadJson,attempt_count AS attemptCount,max_attempts AS maxAttempts")
    .bind(leaseOwner, String(Math.max(15, leaseSeconds)), id).first<Record<string, unknown>>();
  return row ? { id: String(row.id), userId: Number(row.userId), type: String(row.type), entityId: row.entityId == null ? null : String(row.entityId), payload: parseJsonObject(row.payloadJson), attemptCount: Number(row.attemptCount), maxAttempts: Number(row.maxAttempts) } satisfies BackgroundJobClaim : null;
}

export async function heartbeatBackgroundJob(id: string, leaseOwner: string, leaseSeconds = 45) {
  const result = await env.DB.prepare("UPDATE v2_jobs SET lease_until=datetime('now',? || ' seconds'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='running' AND lease_owner=? AND cancel_requested=0 AND datetime(COALESCE(lease_until,'1970-01-01'))>datetime('now')").bind(String(Math.max(15, leaseSeconds)), id, leaseOwner).run();
  return Number(result.meta?.changes || 0) === 1;
}

export async function requeueBackgroundJob(id: string, message: string, leaseOwner?: string) {
  const current = await env.DB.prepare(`SELECT attempt_count AS attemptCount,max_attempts AS maxAttempts FROM v2_jobs WHERE id=?${leaseOwner ? " AND lease_owner=?" : ""}`).bind(id, ...(leaseOwner ? [leaseOwner] : [])).first<{ attemptCount: number; maxAttempts: number }>();
  if (!current) return { exhausted: false, delay: 0, ignored: true };
  const exhausted = Number(current?.attemptCount || 0) >= Number(current?.maxAttempts || 3), nextState = exhausted ? "failed" : "queued", delay = Math.min(300, 5 * 2 ** Math.max(0, Number(current?.attemptCount || 1) - 1));
  const updated = await env.DB.prepare(`UPDATE v2_jobs SET state=?,stage=?,available_at=datetime('now',? || ' seconds'),lease_owner=NULL,lease_until=NULL,error_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?${leaseOwner ? " AND lease_owner=?" : ""}`).bind(nextState, exhausted ? "attempts_exhausted" : "retry_wait", String(delay), JSON.stringify({ message, retryable: !exhausted }), id, ...(leaseOwner ? [leaseOwner] : [])).run();
  if (Number(updated.meta?.changes || 0) !== 1) return { exhausted: false, delay: 0, ignored: true };
  await env.DB.prepare("INSERT INTO v2_job_events(job_id,state,stage,progress,message,detail_json) SELECT id,?,?,progress,?,? FROM v2_jobs WHERE id=?").bind(nextState, exhausted ? "attempts_exhausted" : "retry_wait", message, JSON.stringify({ delaySeconds: delay, exhausted }), id).run();
  return { exhausted, delay, ignored: false };
}

export async function listClaimableBackgroundJobIds(limit = 10) {
  const rows = await env.DB.prepare("SELECT id FROM v2_jobs WHERE cancel_requested=0 AND attempt_count<max_attempts AND datetime(COALESCE(available_at,created_at))<=datetime('now') AND (state='queued' OR (state='running' AND datetime(COALESCE(lease_until,'1970-01-01'))<=datetime('now'))) ORDER BY created_at LIMIT ?").bind(Math.min(25, Math.max(1, limit))).all<{ id: string }>();
  return rows.results.map((row) => String(row.id));
}
