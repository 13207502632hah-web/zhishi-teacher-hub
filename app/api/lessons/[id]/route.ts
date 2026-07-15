import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { lessons } from "../../../../db/schema";
import { audit, isDenied, requireClassAccess, requireLessonAccess, requirePermission } from "../../../lib/access";
import { usesTeachingSlot, validateLessonTime } from "../../../lib/lesson-validation";
import { lessonDisplay } from "../../../lib/lesson-display";

const value = (input: unknown) => String(input || "").trim();
const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const values = (payload: Record<string, unknown>) => ({ classId: payload.classId ? Number(payload.classId) : null, courseName: value(payload.courseName), date: value(payload.date), startTime: value(payload.startTime), endTime: value(payload.endTime), mode: value(payload.mode) || "offline", location: value(payload.location), onlineLink: value(payload.onlineLink), grade: value(payload.grade), stage: value(payload.stage), textbookVersion: value(payload.textbookVersion), volume: value(payload.volume), unit: value(payload.unit), topic: value(payload.topic), knowledgePoints: value(payload.knowledgePoints), teachingGoals: value(payload.teachingGoals), keyPoints: value(payload.keyPoints), difficultPoints: value(payload.difficultPoints), actualContent: value(payload.actualContent), materials: value(payload.materials), activities: value(payload.activities), homework: value(payload.homework), nextPlan: value(payload.nextPlan), participation: payload.participation ? Number(payload.participation) : null, understanding: payload.understanding ? Number(payload.understanding) : null, completion: payload.completion ? Number(payload.completion) : null, discipline: payload.discipline ? Number(payload.discipline) : null, fee: payload.fee === "" || payload.fee == null ? null : Number(payload.fee), feeStatus: value(payload.feeStatus) || "untracked", cancellationReason: value(payload.cancellationReason), status: value(payload.status) || "draft", updatedAt: new Date().toISOString() });

async function conflictFor(payload: Record<string, unknown>, exceptId: number) {
  if (!usesTeachingSlot(payload.status) || !value(payload.date) || !value(payload.startTime) || !value(payload.endTime)) return null;
  return env.DB.prepare("SELECT id FROM lessons WHERE date=? AND status!='cancelled' AND start_time<>'' AND end_time<>'' AND start_time<? AND end_time>? AND id!=? LIMIT 1").bind(value(payload.date), value(payload.endTime), value(payload.startTime), exceptId).first();
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const [row] = await getDb().select().from(lessons).where(eq(lessons.id, id)).limit(1);
  if (!row) return Response.json({ error: "课时不存在" }, { status: 404 });
  const names = row.classId ? await env.DB.prepare("SELECT GROUP_CONCAT(s.name,'、') AS studentNames,c.name AS className FROM classes c LEFT JOIN enrollments e ON e.class_id=c.id AND e.status='active' LEFT JOIN students s ON s.id=e.student_id AND s.status='active' WHERE c.id=? GROUP BY c.id").bind(row.classId).first<Record<string, unknown>>() : null;
  const enriched = { ...row, ...(names || {}) };
  return Response.json({ lesson: { ...enriched, ...lessonDisplay(enriched) } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>, data = values(payload);
  if (!data.date || !data.courseName || !data.stage || !data.grade) return Response.json({ error: "日期、课程名称、学段和年级为必填项" }, { status: 400 });
  if (access.role === "assistant" && !data.classId) return Response.json({ error: "助教创建课时必须关联已授权班级" }, { status: 400 });
  if (data.classId) { const classDenied = await requireClassAccess(access, data.classId); if (classDenied) return classDenied; }
  const timingError = validateLessonTime(data); if (timingError) return Response.json({ error: timingError }, { status: 400 });
  if (await conflictFor(data, id)) return Response.json({ error: "该时段已存在其他课时，请调整时间后再保存" }, { status: 409 });
  const [row] = await getDb().update(lessons).set(data).where(eq(lessons.id, id)).returning();
  await audit(access, "update", "lesson", id, { status: row?.status });
  return row ? Response.json({ lesson: row }) : Response.json({ error: "课时不存在" }, { status: 404 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const [row] = await getDb().delete(lessons).where(eq(lessons.id, id)).returning();
  await audit(access, "delete", "lesson", id);
  return row ? Response.json({ ok: true }) : Response.json({ error: "课时不存在" }, { status: 404 });
}
