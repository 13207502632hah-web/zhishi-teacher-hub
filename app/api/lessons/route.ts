import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { lessons } from "../../../db/schema";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../lib/access";
import { usesTeachingSlot, validateLessonTime } from "../../lib/lesson-validation";

const value = (input: unknown) => String(input || "").trim();

async function conflictFor(payload: Record<string, unknown>, exceptId?: number) {
  const date = value(payload.date), start = value(payload.startTime), end = value(payload.endTime);
  if (!usesTeachingSlot(payload.status) || !date || !start || !end) return null;
  const result = await env.DB.prepare("SELECT id,course_name AS courseName,topic,start_time AS startTime,end_time AS endTime FROM lessons WHERE date=? AND status!='cancelled' AND start_time<>'' AND end_time<>'' AND start_time<? AND end_time>? AND (? IS NULL OR id!=?) ORDER BY start_time LIMIT 1").bind(date, end, start, exceptId || null, exceptId || null).first<Record<string, unknown>>();
  return result || null;
}

function lessonValues(payload: Record<string, unknown>) {
  return { classId: payload.classId ? Number(payload.classId) : null, date: value(payload.date), startTime: value(payload.startTime), endTime: value(payload.endTime), mode: value(payload.mode) || "offline", location: value(payload.location), onlineLink: value(payload.onlineLink), courseName: value(payload.courseName), stage: value(payload.stage), grade: value(payload.grade), textbookVersion: value(payload.textbookVersion), volume: value(payload.volume), unit: value(payload.unit), topic: value(payload.topic), teachingGoals: value(payload.teachingGoals), keyPoints: value(payload.keyPoints), difficultPoints: value(payload.difficultPoints), actualContent: value(payload.actualContent), materials: value(payload.materials), activities: value(payload.activities), homework: value(payload.homework), nextPlan: value(payload.nextPlan), participation: payload.participation ? Number(payload.participation) : null, understanding: payload.understanding ? Number(payload.understanding) : null, completion: payload.completion ? Number(payload.completion) : null, discipline: payload.discipline ? Number(payload.discipline) : null, fee: payload.fee === "" || payload.fee == null ? null : Number(payload.fee), feeStatus: value(payload.feeStatus) || "untracked", cancellationReason: value(payload.cancellationReason), status: value(payload.status) || "draft" };
}

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, query = params.get("q") || "", classId = Number(params.get("classId") || 0), status = params.get("status") || "all", from = params.get("from") || "", to = params.get("to") || "";
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const where: string[] = [], bind: unknown[] = [];
  if (access.role === "assistant") { where.push("l.class_id IS NOT NULL AND EXISTS (SELECT 1 FROM staff_class_access sca WHERE sca.class_id=l.class_id AND sca.user_id=?)"); bind.push(access.id); }
  if (classId) { where.push("l.class_id=?"); bind.push(classId); }
  if (query) { where.push("(l.course_name LIKE ? OR l.topic LIKE ? OR l.unit LIKE ?)"); bind.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (status !== "all") { where.push("l.status=?"); bind.push(status); }
  if (from) { where.push("l.date>=?"); bind.push(from); }
  if (to) { where.push("l.date<=?"); bind.push(to); }
  const sql = `SELECT l.*,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.date DESC,l.start_time DESC,l.updated_at DESC`;
  const rows = await env.DB.prepare(sql).bind(...bind).all(), lessonRows = (rows.results as Array<Record<string, unknown>>).map((row) => ({ ...row, classId: row.class_id, startTime: row.start_time, endTime: row.end_time, onlineLink: row.online_link, courseName: row.course_name, textbookVersion: row.textbook_version, teachingGoals: row.teaching_goals, keyPoints: row.key_points, difficultPoints: row.difficult_points, actualContent: row.actual_content, nextPlan: row.next_plan, feeStatus: row.fee_status, cancellationReason: row.cancellation_reason, createdAt: row.created_at, updatedAt: row.updated_at }));
  return Response.json({ lessons: lessonRows });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, data = lessonValues(payload);
  if (!data.date || !data.courseName || !data.stage || !data.grade) return Response.json({ error: "日期、课程名称、学段和年级为必填项" }, { status: 400 });
  if (access.role === "assistant" && !data.classId) return Response.json({ error: "助教创建课时必须关联已授权班级" }, { status: 400 });
  if (data.classId) { const denied = await requireClassAccess(access, data.classId); if (denied) return denied; }
  const timingError = validateLessonTime(data); if (timingError) return Response.json({ error: timingError }, { status: 400 });
  const conflict = await conflictFor(data); if (conflict) return Response.json({ error: "该时段已存在其他课时，请调整时间后再保存", conflict }, { status: 409 });
  const [row] = await getDb().insert(lessons).values(data).returning();
  await audit(access, "create", "lesson", row.id, { status: row.status, classId: row.classId });
  return Response.json({ lesson: row }, { status: 201 });
}
