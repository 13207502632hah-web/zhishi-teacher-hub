import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { classes, enrollments, lessons, students } from "../../../../db/schema";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const value = (input: unknown) => String(input || "").trim();

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const db = getDb(), [row] = await db.select().from(classes).where(eq(classes.id, id)).limit(1);
  if (!row) return Response.json({ error: "班级不存在" }, { status: 404 });
  const [members, lessonRows, attendance, homework] = await Promise.all([
    db.select({ id: students.id, name: students.name, nickname: students.nickname, grade: students.grade, weakKnowledge: students.weakKnowledge, riskTags: students.riskTags, riskConfirmed: students.riskConfirmed }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(and(eq(enrollments.classId, id), eq(enrollments.status, "active"))),
    db.select().from(lessons).where(eq(lessons.classId, id)),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE l.class_id=?").bind(id).first<Record<string, number>>(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE l.class_id=?").bind(id).first<Record<string, number>>(),
  ]);
  const rate = (source: Record<string, number> | null) => source && source.total ? Math.round(Number(source.done || 0) / Number(source.total) * 100) : null;
  return Response.json({ class: row, members, lessons: lessonRows, attendanceRate: rate(attendance), homeworkRate: rate(homework) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>, name = value(payload.name), stage = value(payload.stage), grade = value(payload.grade);
  if (!name || !stage || !grade) return Response.json({ error: "班级名称、学段、年级为必填项" }, { status: 400 });
  const status = payload.status === "archived" ? "archived" : "active";
  const [row] = await getDb().update(classes).set({ name, stage, grade, courseType: value(payload.courseType), startDate: value(payload.startDate) || null, schedule: value(payload.schedule), notes: value(payload.notes), status, archivedAt: status === "archived" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(classes.id, id)).returning();
  await audit(access, status === "archived" ? "archive" : "update", "class", id);
  return row ? Response.json({ class: row }) : Response.json({ error: "班级不存在" }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as { studentId: number }, studentId = Number(payload.studentId);
  if (!Number.isFinite(studentId) || studentId <= 0) return Response.json({ error: "请选择有效的学生" }, { status: 400 });
  await getDb().insert(enrollments).values({ classId: id, studentId }).onConflictDoUpdate({ target: [enrollments.classId, enrollments.studentId], set: { status: "active" } });
  await audit(access, "link", "enrollment", `${id}:${studentId}`);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as { studentId: number }, studentId = Number(payload.studentId);
  await getDb().update(enrollments).set({ status: "inactive" }).where(and(eq(enrollments.classId, id), eq(enrollments.studentId, studentId)));
  await audit(access, "unlink", "enrollment", `${id}:${studentId}`);
  return Response.json({ ok: true });
}
