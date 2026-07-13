import { env } from "cloudflare:workers";
import type { MiniAccess } from "../mini-auth";

export type SyncEventInput = {
  eventType: string;
  entityType: string;
  entityId: string | number;
  audienceRole?: "teacher" | "student" | "parent" | null;
  studentId?: number | null;
  accountId?: number | null;
  payload?: Record<string, unknown>;
  deleted?: boolean;
};

export async function recordSyncEvent(input: SyncEventInput) {
  await env.DB.prepare("INSERT INTO sync_events(event_type,entity_type,entity_id,audience_role,student_id,account_id,payload,is_deleted) VALUES(?,?,?,?,?,?,?,?)")
    .bind(input.eventType, input.entityType, String(input.entityId), input.audienceRole || null, input.studentId || null, input.accountId || null, input.payload ? JSON.stringify(input.payload) : null, input.deleted ? 1 : 0).run();
}

export async function recordConfirmedFeedbackEvent(row: Record<string, unknown>) {
  if (row.status !== "confirmed") return;
  let studentIds = row.studentId ? [Number(row.studentId)] : [];
  if (!studentIds.length) {
    const classId = Number(row.classId || (row.lessonId ? (await env.DB.prepare("SELECT class_id AS classId FROM lessons WHERE id=?").bind(Number(row.lessonId)).first<{ classId: number }>())?.classId : 0));
    if (classId) studentIds = (await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(classId).all<{ studentId: number }>()).results.map((item) => Number(item.studentId));
  }
  for (const studentId of studentIds) await recordSyncEvent({ eventType: "feedback.confirmed", entityType: "feedback", entityId: String(row.id), studentId, payload: { lessonId: row.lessonId || null, confirmedAt: row.confirmedAt || null } });
}

export async function syncEventsFor(access: MiniAccess, cursor: number) {
  const studentIds = await accessibleStudentIds(access);
  const clauses = ["account_id=?"], bindings: unknown[] = [cursor, access.accountId];
  if (access.role === "teacher") clauses.push("audience_role='teacher'", "(audience_role IS NULL AND student_id IS NULL AND account_id IS NULL)");
  else if (studentIds.length) { clauses.push(`student_id IN (${studentIds.map(() => "?").join(",")})`); bindings.push(...studentIds); }
  const rows = await env.DB.prepare(`SELECT id,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,payload,is_deleted AS deleted,created_at AS createdAt FROM sync_events WHERE id>? AND (${clauses.join(" OR ")}) ORDER BY id LIMIT 250`)
    .bind(...bindings).all<Record<string, unknown>>();
  const events = rows.results.map((row) => ({ ...row, payload: row.payload ? safeJson(String(row.payload)) : null, deleted: Boolean(row.deleted) }));
  const latest = events.length ? Number((events[events.length - 1] as Record<string, unknown>).id) : Number((await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS cursor FROM sync_events").first<{ cursor: number }>())?.cursor || cursor);
  return { events, cursor: latest, hasMore: events.length === 250 };
}

export async function accessibleStudentIds(access: MiniAccess) {
  if (access.role === "teacher") return [];
  const rows = await env.DB.prepare("SELECT student_id AS studentId FROM mini_bindings WHERE account_id=? AND status='active' UNION SELECT student_id AS studentId FROM parent_student_links WHERE parent_account_id=? AND status='active'")
    .bind(access.accountId, access.accountId).all<{ studentId: number }>();
  const ids = rows.results.map((row) => Number(row.studentId)).filter(Boolean);
  if (access.role === "student" && access.studentId) ids.push(Number(access.studentId));
  return [...new Set(ids)];
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}
