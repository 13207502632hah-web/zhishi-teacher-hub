import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { hasClassAccess, hasLessonAccess, hasStudentAccess } from "../access";
import { recordSyncEvent } from "../services/mini-sync-service";

export const mobileRecordKinds = ["lesson_note", "homework", "feedback_draft", "reflection", "idea"] as const;
export type MobileRecordKind = (typeof mobileRecordKinds)[number];
export type MobileRecord = {
  id: string; kind: MobileRecordKind; title: string; content: string; occurredAt: string;
  lessonId: number | null; classId: number | null; studentId: number | null;
  status: "draft" | "confirmed"; audience: "private" | "student" | "parent" | "both";
  source: "web" | "ios" | "mini"; version: number; updatedAt: string; createdAt: string;
};

type RecordRow = Record<string, unknown>;
type UpsertInput = Partial<MobileRecord> & { id?: string; operationId: string; baseVersion?: number };

const clean = (value: unknown, maximum: number) => String(value || "").trim().slice(0, maximum);
const numberId = (value: unknown) => { const id = Number(value || 0); return Number.isInteger(id) && id > 0 ? id : null; };
const validRecordId = (value: unknown) => /^[a-zA-Z0-9][a-zA-Z0-9-]{7,79}$/.test(String(value || ""));

export function mobileRecordFromRow(row: RecordRow): MobileRecord {
  return {
    id: String(row.id), kind: mobileRecordKinds.includes(row.kind as MobileRecordKind) ? row.kind as MobileRecordKind : "idea",
    title: String(row.title || ""), content: String(row.content || ""), occurredAt: String(row.occurredAt || ""),
    lessonId: numberId(row.lessonId), classId: numberId(row.classId), studentId: numberId(row.studentId),
    status: row.status === "confirmed" ? "confirmed" : "draft",
    audience: ["student", "parent", "both"].includes(String(row.audience)) ? row.audience as MobileRecord["audience"] : "private",
    source: ["ios", "mini"].includes(String(row.source)) ? row.source as MobileRecord["source"] : "web",
    version: Math.max(1, Number(row.version || 1)), updatedAt: String(row.updatedAt || ""), createdAt: String(row.createdAt || ""),
  };
}

const selectRecord = "SELECT id,kind,title,content,occurred_at AS occurredAt,lesson_id AS lessonId,class_id AS classId,student_id AS studentId,status,audience,source,version,created_at AS createdAt,updated_at AS updatedAt FROM v2_mobile_records";

async function validateLinks(access: AccessContext, lessonId: number | null, classId: number | null, studentId: number | null) {
  if (lessonId && !await hasLessonAccess(access, lessonId)) throw new Error("当前账号无权关联该课时");
  if (classId && !await hasClassAccess(access, classId)) throw new Error("当前账号无权关联该班级");
  if (studentId && !await hasStudentAccess(access, studentId)) throw new Error("当前账号无权关联该学生");
  if (lessonId && !classId) classId = numberId((await env.DB.prepare("SELECT class_id AS classId FROM lessons WHERE id=?").bind(lessonId).first<{ classId: number | null }>())?.classId);
  if (studentId && classId) {
    const enrollment = await env.DB.prepare("SELECT 1 AS ok FROM enrollments WHERE student_id=? AND class_id=? AND status='active'").bind(studentId, classId).first();
    if (!enrollment) throw new Error("所选学生不在关联班级中");
  }
  return { lessonId, classId, studentId };
}

async function currentRecord(access: AccessContext, id: string) {
  const row = await env.DB.prepare(`${selectRecord} WHERE id=? AND user_id=?`).bind(id, access.id).first<RecordRow>();
  return row ? mobileRecordFromRow(row) : null;
}

export async function listMobileRecords(access: AccessContext, cursor = 0, limit = 100) {
  const bounded = Math.min(200, Math.max(1, limit));
  if (cursor > 0) {
    const rows = await env.DB.prepare("SELECT id AS cursor,record_id AS recordId,version,payload_json AS payloadJson,is_deleted AS deleted,created_at AS createdAt FROM v2_mobile_record_changes WHERE user_id=? AND id>? ORDER BY id LIMIT ?").bind(access.id, cursor, bounded).all<RecordRow>();
    const changes = rows.results.map((row) => ({ cursor: Number(row.cursor), recordId: String(row.recordId), version: Number(row.version), record: row.deleted ? null : safeJson(row.payloadJson), deleted: Boolean(row.deleted), createdAt: String(row.createdAt) }));
    return { records: [] as MobileRecord[], changes, cursor: changes.length ? changes[changes.length - 1].cursor : cursor, hasMore: changes.length === bounded, full: false };
  }
  const [records, latest] = await Promise.all([
    env.DB.prepare(`${selectRecord} WHERE user_id=? AND deleted_at IS NULL ORDER BY occurred_at DESC,updated_at DESC LIMIT ?`).bind(access.id, bounded).all<RecordRow>(),
    env.DB.prepare("SELECT COALESCE(MAX(id),0) AS cursor FROM v2_mobile_record_changes WHERE user_id=?").bind(access.id).first<{ cursor: number }>(),
  ]);
  return { records: records.results.map(mobileRecordFromRow), changes: [], cursor: Number(latest?.cursor || 0), hasMore: records.results.length === bounded, full: true };
}

export async function upsertMobileRecord(access: AccessContext, input: UpsertInput, source: MobileRecord["source"] = "web") {
  const operationId = clean(input.operationId, 120); if (operationId.length < 8) throw new Error("operationId 无效");
  const repeated = await env.DB.prepare("SELECT record_id AS recordId FROM v2_mobile_record_changes WHERE user_id=? AND operation_id=?").bind(access.id, operationId).first<{ recordId: string }>();
  if (repeated) return { record: await currentRecord(access, repeated.recordId), repeated: true, conflict: false };
  const id = validRecordId(input.id) ? String(input.id) : crypto.randomUUID(), existing = await currentRecord(access, id);
  const kind = mobileRecordKinds.includes(input.kind as MobileRecordKind) ? input.kind as MobileRecordKind : existing?.kind || "lesson_note";
  const title = clean(input.title ?? existing?.title, 160), content = clean(input.content ?? existing?.content, 20_000);
  const occurredAt = clean(input.occurredAt ?? existing?.occurredAt ?? new Date().toISOString(), 40);
  if (!title || !content || !Number.isFinite(Date.parse(occurredAt))) throw new Error("标题、内容和记录时间必须完整");
  const supplied = (key: keyof UpsertInput) => Object.prototype.hasOwnProperty.call(input, key);
  const links = await validateLinks(access,
    numberId(supplied("lessonId") ? input.lessonId : existing?.lessonId),
    numberId(supplied("classId") ? input.classId : existing?.classId),
    numberId(supplied("studentId") ? input.studentId : existing?.studentId));
  if (existing) {
    if (Number(input.baseVersion || 0) !== existing.version) return { record: existing, repeated: false, conflict: true };
    const nextVersion = existing.version + 1;
    const result = await env.DB.prepare("UPDATE v2_mobile_records SET lesson_id=?,class_id=?,student_id=?,kind=?,title=?,content=?,occurred_at=?,status='draft',audience='private',source=?,version=?,operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL")
      .bind(links.lessonId, links.classId, links.studentId, kind, title, content, occurredAt, source, nextVersion, operationId, id, access.id, existing.version).run();
    if (Number(result.meta?.changes || 0) !== 1) return { record: await currentRecord(access, id), repeated: false, conflict: true };
  } else {
    await env.DB.prepare("INSERT INTO v2_mobile_records(id,user_id,lesson_id,class_id,student_id,kind,title,content,occurred_at,status,audience,source,version,operation_id) VALUES(?,?,?,?,?,?,?,?,?,'draft','private',?,1,?)")
      .bind(id, access.id, links.lessonId, links.classId, links.studentId, kind, title, content, occurredAt, source, operationId).run();
  }
  const record = await currentRecord(access, id); if (!record) throw new Error("记录保存后无法读取");
  await env.DB.prepare("INSERT INTO v2_mobile_record_changes(user_id,record_id,version,operation_id,payload_json) VALUES(?,?,?,?,?)").bind(access.id, id, record.version, operationId, JSON.stringify(record)).run();
  return { record, repeated: false, conflict: false };
}

export async function deleteMobileRecord(access: AccessContext, id: string, operationId: string, baseVersion: number) {
  const repeated = await env.DB.prepare("SELECT 1 AS ok FROM v2_mobile_record_changes WHERE user_id=? AND operation_id=?").bind(access.id, operationId).first();
  if (repeated) return { deleted: true, repeated: true, conflict: false };
  const existing = await currentRecord(access, id); if (!existing) return null;
  if (existing.status === "confirmed") throw new Error("已共享记录不能直接删除，请先在待确认中心撤回");
  if (existing.version !== baseVersion) return { deleted: false, repeated: false, conflict: true, record: existing };
  const nextVersion = existing.version + 1, result = await env.DB.prepare("UPDATE v2_mobile_records SET version=?,operation_id=?,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL").bind(nextVersion, operationId, id, access.id, existing.version).run();
  if (Number(result.meta?.changes || 0) !== 1) return { deleted: false, repeated: false, conflict: true, record: await currentRecord(access, id) };
  await env.DB.prepare("INSERT INTO v2_mobile_record_changes(user_id,record_id,version,operation_id,payload_json,is_deleted) VALUES(?,?,?,?,?,1)").bind(access.id, id, nextVersion, operationId, "{}").run();
  return { deleted: true, repeated: false, conflict: false };
}

export async function confirmMobileRecordShare(access: AccessContext, id: string, audience: "student" | "parent" | "both") {
  const existing = await currentRecord(access, id); if (!existing) throw new Error("移动记录不存在");
  if (!existing.studentId && !existing.classId) throw new Error("共享记录必须先关联学生或班级");
  if (!["student", "parent", "both"].includes(audience)) throw new Error("共享对象无效");
  const operationId = `share-${id}-v${existing.version}`, nextVersion = existing.version + 1;
  await env.DB.prepare("UPDATE v2_mobile_records SET status='confirmed',audience=?,version=?,operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL").bind(audience, nextVersion, operationId, id, access.id, existing.version).run();
  const record = await currentRecord(access, id); if (!record) throw new Error("共享记录更新失败");
  await env.DB.prepare("INSERT OR IGNORE INTO v2_mobile_record_changes(user_id,record_id,version,operation_id,payload_json) VALUES(?,?,?,?,?)").bind(access.id, id, record.version, operationId, JSON.stringify(record)).run();
  let students = record.studentId ? [record.studentId] : [];
  if (!students.length && record.classId) students = (await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(record.classId).all<{ studentId: number }>()).results.map((row) => Number(row.studentId));
  const audienceRole = audience === "both" ? null : audience;
  for (const studentId of students) await recordSyncEvent({ eventType: "mobile_record.confirmed", entityType: "mobile_record", entityId: id, audienceRole, studentId, payload: { kind: record.kind, title: record.title, occurredAt: record.occurredAt, audience } });
  return { record, recipients: students.length };
}

function safeJson(value: unknown) { try { return JSON.parse(String(value || "{}")); } catch { return null; } }
