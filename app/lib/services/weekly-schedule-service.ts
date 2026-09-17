import type { AccessContext } from "../access";
import { calendarDayDifference, isCalendarDate, shiftCalendarDate, validClockTime, weeklyDates } from "../weekly-schedule";

type Row = Record<string, unknown>;
type Slot = { id: number; date: string; startTime: string; endTime: string; courseName: string; location: string; topic: string; status: string };
export class ScheduleError extends Error { constructor(message: string, public status = 400) { super(message); } }
const text = (v: unknown) => String(v ?? "").trim();
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map((v) => v.toString(16).padStart(2, "0")).join("");
const mutable = (row: Row) => !["completed", "cancelled"].includes(text(row.status)) && !row.financeLocked;
const projection = `l.*,o.series_id AS seriesId,o.original_date AS originalDate,o.scheduled_date AS scheduledDate,o.is_exception AS isException,
  EXISTS(SELECT 1 FROM lesson_finance f WHERE f.lesson_id=l.id AND (f.confirmed_at IS NOT NULL OR f.received_amount>0)) AS financeLocked`;
const conflictQuery = `SELECT l.id,l.date,l.course_name AS courseName,l.start_time AS startTime,l.end_time AS endTime
 FROM lessons l JOIN json_each(?) p ON l.date=json_extract(p.value,'$.date')
 WHERE l.status!='cancelled' AND json_extract(p.value,'$.status')!='cancelled'
 AND l.start_time<json_extract(p.value,'$.endTime') AND l.end_time>json_extract(p.value,'$.startTime')
 AND l.id NOT IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`;

function validateSlot(slot: Slot) {
  if (!isCalendarDate(slot.date)) throw new ScheduleError("上课日期无效");
  if (!validClockTime(slot.startTime) || !validClockTime(slot.endTime) || slot.startTime >= slot.endTime) throw new ScheduleError("请填写有效的起止时间，结束时间须晚于开始时间");
  if (!slot.courseName || slot.courseName.length > 120 || slot.location.length > 200 || slot.topic.length > 500) throw new ScheduleError("请填写课程名称，并缩短过长的课程、地点或课题文字");
}

async function authorizeClass(db: D1Database, access: AccessContext, classId: number | null) {
  if (!classId) { if (access.role !== "teacher") throw new ScheduleError("助教必须选择已授权班级", 403); return; }
  const row = await db.prepare("SELECT id,owner_id AS ownerId FROM classes WHERE id=? AND status='active'").bind(classId).first<Row>();
  if (!row) throw new ScheduleError("班级不存在或已停用");
  if (access.role === "teacher" && (row.ownerId == null || Number(row.ownerId) === access.id)) return;
  if (access.role === "assistant" && await db.prepare("SELECT 1 FROM staff_class_access WHERE class_id=? AND user_id=?").bind(classId, access.id).first()) return;
  throw new ScheduleError("无权操作该班级", 403);
}

export async function listWeeklySchedules(db: D1Database, access: AccessContext, seriesId = "") {
  const series = (await db.prepare("SELECT s.*,(SELECT COUNT(*) FROM lesson_occurrences o WHERE o.series_id=s.id) AS count FROM lesson_series s WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100").bind(access.id).all<Row>()).results;
  const selected = seriesId || text(series[0]?.id);
  const lessons = selected ? (await db.prepare(`SELECT ${projection},c.name AS className FROM lessons l JOIN lesson_occurrences o ON o.lesson_id=l.id JOIN lesson_series s ON s.id=o.series_id LEFT JOIN classes c ON c.id=l.class_id WHERE s.user_id=? AND s.id=? ORDER BY o.original_date`).bind(access.id, selected).all<Row>()).results : [];
  return { series, selected, lessons };
}

export async function planWeeklySchedule(db: D1Database, access: AccessContext, input: Row) {
  const kind = input.kind === "create" ? "create" : input.kind === "change" ? "change" : "";
  if (!kind) throw new ScheduleError("课表操作无效");
  let series: Row | null = null, before: Row[] = [], skipped: Row[] = [], slots: Slot[] = [];
  let classId: number | null = null;
  if (kind === "create") {
    classId = input.classId ? Number(input.classId) : null;
    if (classId !== null && (!Number.isInteger(classId) || classId < 1)) throw new ScheduleError("班级编号无效");
    await authorizeClass(db, access, classId);
    if (!["初中", "高中"].includes(text(input.stage)) || !(input.stage === "初中" ? ["七年级", "八年级", "九年级"] : ["高一", "高二", "高三"]).includes(text(input.grade))) throw new ScheduleError("学段与年级不匹配");
    let dates: string[];
    try { dates = weeklyDates(text(input.startDate), text(input.endDate), Number(input.weekday)); } catch (error) { throw new ScheduleError((error as Error).message); }
    slots = dates.map((date) => ({ id: 0, date, startTime: text(input.startTime), endTime: text(input.endTime), courseName: text(input.courseName), location: text(input.location), topic: text(input.topic), status: "scheduled" }));
  } else {
    const lessonId = Number(input.lessonId);
    const anchor = await db.prepare(`SELECT ${projection} FROM lessons l JOIN lesson_occurrences o ON o.lesson_id=l.id JOIN lesson_series s ON s.id=o.series_id WHERE l.id=? AND s.user_id=?`).bind(lessonId, access.id).first<Row>();
    if (!anchor) throw new ScheduleError("循环课次不存在或无权修改", 404);
    if (!mutable(anchor)) throw new ScheduleError("该课次已完成、取消或进入收款确认，不能调课", 409);
    if (!["single", "following"].includes(text(input.scope))) throw new ScheduleError("请选择仅本次或本次及后续");
    if (!["reschedule", "cancel"].includes(text(input.action))) throw new ScheduleError("请选择调课改课或停课");
    if (!text(input.reason) || text(input.reason).length > 500) throw new ScheduleError("请填写本次变更原因（不超过500字）");
    series = await db.prepare("SELECT * FROM lesson_series WHERE id=?").bind(anchor.seriesId).first<Row>();
    const candidates = input.scope === "single" ? [anchor] : (await db.prepare(`SELECT ${projection} FROM lessons l JOIN lesson_occurrences o ON o.lesson_id=l.id WHERE o.series_id=? AND o.original_date>=? ORDER BY o.original_date`).bind(anchor.seriesId, anchor.originalDate).all<Row>()).results;
    before = candidates.filter((row) => mutable(row) && (Number(row.id) === lessonId || !row.isException));
    skipped = candidates.filter((row) => !before.includes(row)).map((row) => ({ id: row.id, date: row.date, reason: !mutable(row) ? "已完成、取消或财务锁定" : "已单独改动，保留原安排" }));
    for (const row of before) await authorizeClass(db, access, row.class_id ? Number(row.class_id) : null);
    if (input.action === "reschedule" && !isCalendarDate(input.date)) throw new ScheduleError("调课日期无效");
    const delta = input.action === "reschedule" ? calendarDayDifference(text(anchor.scheduledDate), text(input.date)) : 0;
    slots = before.map((row) => ({
      id: Number(row.id), date: input.action === "cancel" ? text(row.date) : input.scope === "single" ? text(input.date) : shiftCalendarDate(text(row.scheduledDate), delta),
      startTime: input.action === "cancel" ? text(row.start_time) : text(input.startTime), endTime: input.action === "cancel" ? text(row.end_time) : text(input.endTime),
      courseName: input.action === "cancel" ? text(row.course_name) : text(input.courseName), location: input.action === "cancel" ? text(row.location) : text(input.location),
      topic: input.action === "cancel" ? text(row.topic) : text(input.topic), status: input.action === "cancel" ? "cancelled" : "rescheduled",
    }));
  }
  slots.forEach(validateSlot);
  const ids = slots.map((slot) => slot.id).filter(Boolean);
  const conflicts = (await db.prepare(conflictQuery).bind(JSON.stringify(slots), JSON.stringify(ids)).all<Row>()).results;
  const token = await hash({ input: requestPayload(input), series, before, skipped, slots, conflicts });
  return { kind, classId, series, before, slots, skipped, conflicts, token };
}

function requestPayload(input: Row) {
  const keys = ["kind", "classId", "stage", "grade", "startDate", "endDate", "weekday", "lessonId", "scope", "action", "reason", "date", "startTime", "endTime", "courseName", "location", "topic"];
  return Object.fromEntries(keys.map((key) => [key, input[key] ?? null]));
}

export async function commitWeeklySchedule(db: D1Database, access: AccessContext, input: Row) {
  const operation = text(input.operationId);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(operation)) throw new ScheduleError("操作编号无效，请重新预览");
  const operationKey = `${access.id}:${operation}`, requestJson = JSON.stringify(requestPayload(input));
  const replay = async () => {
    const old = await db.prepare("SELECT request_json AS requestJson,result_json AS resultJson FROM lesson_series_operations WHERE id=? AND user_id=?").bind(operationKey, access.id).first<{ requestJson: string; resultJson: string }>();
    if (!old) return null;
    if (old.requestJson !== requestJson) throw new ScheduleError("操作编号已用于另一项修改，请重新预览", 409);
    return { ...JSON.parse(old.resultJson), repeated: true };
  };
  const previous = await replay(); if (previous) return previous;
  const plan = await planWeeklySchedule(db, access, input);
  if (plan.conflicts.length) throw new ScheduleError("存在时间冲突，未写入任何课次；请调整后重新预览", 409);
  if (plan.token !== input.previewToken) throw new ScheduleError("课表或输入已发生变化，请重新预览再确认", 409);
  const seriesId = text(plan.series?.id) || crypto.randomUUID();
  const result = { seriesId, count: plan.slots.length, skipped: plan.skipped.length };
  const slotsJson = JSON.stringify(plan.slots), idsJson = JSON.stringify(plan.slots.map((slot) => slot.id).filter(Boolean));
  // This assertion runs INSIDE the same D1 batch as all writes. A failed CHECK rolls back the entire operation.
  // Re-check collisions, the complete old row snapshots and financial locks to close the preview/write race.
  const snapshotChecks = plan.before.map((row) => ({ id: row.id, date: row.date, start: row.start_time, end: row.end_time, status: row.status, updated: row.updated_at, classId: row.class_id, course: row.course_name, location: row.location, topic: row.topic }));
  const guard = `NOT EXISTS(${conflictQuery}) AND (?='create' OR (
    EXISTS(SELECT 1 FROM lesson_series WHERE id=? AND version=?) AND
    (SELECT COUNT(*) FROM lessons l JOIN json_each(?) b ON l.id=json_extract(b.value,'$.id')
      WHERE l.date IS json_extract(b.value,'$.date') AND l.start_time IS json_extract(b.value,'$.start') AND l.end_time IS json_extract(b.value,'$.end')
      AND l.status IS json_extract(b.value,'$.status') AND l.updated_at IS json_extract(b.value,'$.updated') AND l.class_id IS json_extract(b.value,'$.classId')
      AND l.course_name IS json_extract(b.value,'$.course') AND l.location IS json_extract(b.value,'$.location') AND l.topic IS json_extract(b.value,'$.topic')
      AND NOT EXISTS(SELECT 1 FROM lesson_finance f WHERE f.lesson_id=l.id AND (f.confirmed_at IS NOT NULL OR f.received_amount>0)))=?))`;
  const statements = [db.prepare(`INSERT INTO lesson_series_operations(id,user_id,request_json,result_json,validated) VALUES(?,?,?,?,CASE WHEN ${guard} THEN 1 ELSE 0 END)`)
    .bind(operationKey, access.id, requestJson, JSON.stringify(result), slotsJson, idsJson, plan.kind, seriesId, plan.series?.version || 0, JSON.stringify(snapshotChecks), plan.before.length)];
  if (plan.kind === "create") {
    statements.push(db.prepare("INSERT INTO lesson_series(id,user_id,name,start_date,end_date,weekday,rule_json) VALUES(?,?,?,?,?,?,?)").bind(seriesId, access.id, text(input.courseName), text(input.startDate), text(input.endDate), Number(input.weekday), requestJson));
    for (const slot of plan.slots) {
      statements.push(db.prepare("INSERT INTO lessons(class_id,date,start_time,end_time,course_name,stage,grade,location,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'scheduled')").bind(plan.classId, slot.date, slot.startTime, slot.endTime, slot.courseName, text(input.stage), text(input.grade), slot.location, slot.topic));
      statements.push(db.prepare("INSERT INTO lesson_occurrences(lesson_id,series_id,original_date,scheduled_date) VALUES(last_insert_rowid(),?,?,?)").bind(seriesId, slot.date, slot.date));
    }
  } else {
    for (const slot of plan.slots) {
      statements.push(db.prepare("UPDATE lessons SET date=?,start_time=?,end_time=?,course_name=?,location=?,topic=?,status=?,cancellation_reason=?,updated_at=? WHERE id=?").bind(slot.date, slot.startTime, slot.endTime, slot.courseName, slot.location, slot.topic, slot.status, input.action === "cancel" ? text(input.reason) : "", new Date().toISOString(), slot.id));
      statements.push(input.scope === "single"
        ? db.prepare("UPDATE lesson_occurrences SET is_exception=1 WHERE lesson_id=?").bind(slot.id)
        : db.prepare("UPDATE lesson_occurrences SET scheduled_date=?,is_exception=0 WHERE lesson_id=?").bind(slot.date, slot.id));
    }
    statements.push(db.prepare("UPDATE lesson_series SET version=version+1,updated_at=? WHERE id=?").bind(new Date().toISOString(), seriesId));
  }
  statements.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)").bind(access.id, `weekly_schedule_${plan.kind}`, "lesson_series", seriesId, JSON.stringify({ operationId: operation, reason: input.reason || "教师确认创建", scope: input.scope || "create", before: plan.before, after: plan.slots, skipped: plan.skipped })));
  try { await db.batch(statements); }
  catch (error) {
    const repeated = await replay(); if (repeated) return repeated;
    if (/lesson_series_operation_validated|CHECK constraint/.test(String(error))) throw new ScheduleError("保存时课表发生冲突或变化，本次已全部撤回，请重新预览", 409);
    throw error;
  }
  return { ...result, repeated: false };
}
