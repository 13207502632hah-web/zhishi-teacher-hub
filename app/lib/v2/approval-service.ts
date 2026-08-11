import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { isApprovalState, parseJsonArray, parseJsonObject, type JsonObject, type V2Approval } from "./contracts";

const rowToApproval = (row: Record<string, unknown>): V2Approval => ({
  id: String(row.id), actionType: String(row.actionType), entityType: String(row.entityType), entityId: row.entityId == null ? null : String(row.entityId),
  title: String(row.title), summary: String(row.summary), payload: parseJsonObject(row.payloadJson), evidence: parseJsonArray(row.evidenceJson),
  confidence: row.confidence == null ? null : Number(row.confidence), state: isApprovalState(row.state) ? row.state : "expired", createdAt: String(row.createdAt || ""),
  createdBy: row.createdBy == null ? null : Number(row.createdBy), createdByName: row.createdByName == null ? null : String(row.createdByName),
});

export async function createApproval(access: AccessContext, input: { jobId?: string; actionType: string; entityType: string; entityId?: string | number; title: string; summary: string; payload?: JsonObject; evidence?: unknown[]; confidence?: number; expiresAt?: string }) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO v2_approvals(id,user_id,job_id,action_type,entity_type,entity_id,title,summary,payload_json,evidence_json,confidence,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, access.id, input.jobId || null, input.actionType, input.entityType, input.entityId == null ? null : String(input.entityId), input.title, input.summary, JSON.stringify(input.payload || {}), JSON.stringify(input.evidence || []), input.confidence == null ? null : Math.max(0, Math.min(1, input.confidence)), input.expiresAt || null).run();
  return getApproval(access, id);
}

export async function getApproval(access: AccessContext, id: string) {
  const row = await env.DB.prepare(`SELECT a.id,a.action_type AS actionType,a.entity_type AS entityType,a.entity_id AS entityId,a.title,a.summary,a.payload_json AS payloadJson,a.evidence_json AS evidenceJson,a.confidence,a.state,a.created_at AS createdAt,a.user_id AS createdBy,u.name AS createdByName FROM v2_approvals a LEFT JOIN users u ON u.id=a.user_id WHERE a.id=?${access.role === "teacher" ? "" : " AND a.user_id=?"}`)
    .bind(id, ...(access.role === "teacher" ? [] : [access.id])).first<Record<string, unknown>>();
  return row ? rowToApproval(row) : null;
}

export async function listApprovals(access: AccessContext, state = "pending", limit = 50) {
  const normalized = isApprovalState(state) ? state : "pending";
  const rows = await env.DB.prepare(`SELECT a.id,a.action_type AS actionType,a.entity_type AS entityType,a.entity_id AS entityId,a.title,a.summary,a.payload_json AS payloadJson,a.evidence_json AS evidenceJson,a.confidence,a.state,a.created_at AS createdAt,a.user_id AS createdBy,u.name AS createdByName FROM v2_approvals a LEFT JOIN users u ON u.id=a.user_id WHERE ${access.role === "teacher" ? "1=1" : "a.user_id=?"} AND a.state=? ORDER BY a.created_at DESC LIMIT ?`)
    .bind(...(access.role === "teacher" ? [] : [access.id]), normalized, Math.min(100, Math.max(1, limit))).all<Record<string, unknown>>();
  return rows.results.map(rowToApproval);
}

export async function decideApproval(access: AccessContext, id: string, decision: "approved" | "rejected", note = "") {
  if (access.role !== "teacher") return null;
  const result = await env.DB.prepare("UPDATE v2_approvals SET state=?,decision_note=?,decided_by=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='pending' AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))")
    .bind(decision, note.slice(0, 500), access.id, id).run();
  if (!result.success || Number(result.meta?.changes || 0) < 1) return null;
  return getApproval(access, id);
}
