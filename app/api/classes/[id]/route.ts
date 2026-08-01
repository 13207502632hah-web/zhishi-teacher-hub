import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { classes, enrollments, lessons, students } from "../../../../db/schema";
import { audit, isDenied, requireClassAccess, requirePermission, requireStudentAccess } from "../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const value = (input: unknown) => String(input || "").trim();

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const db = getDb(), [row] = await db.select().from(classes).where(eq(classes.id, id)).limit(1);
  if (!row) return Response.json({ error: "班级不存在" }, { status: 404 });
  const [members, lessonRows, attendance, homework, assessmentRows, weakRows] = await Promise.all([
    db.select({ id: students.id, name: students.name, nickname: students.nickname, grade: students.grade, weakKnowledge: students.weakKnowledge, riskTags: students.riskTags, riskConfirmed: students.riskConfirmed }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(and(eq(enrollments.classId, id), eq(enrollments.status, "active"), eq(students.status, "active"))),
    db.select().from(lessons).where(eq(lessons.classId, id)).orderBy(desc(lessons.date), desc(lessons.startTime)),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE l.class_id=?").bind(id).first<Record<string, number>>(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE COALESCE(a.class_id,l.class_id)=?").bind(id).first<Record<string, number>>(),
    env.DB.prepare("SELECT a.id,a.title,a.date,a.total_score AS totalScore,a.status,COUNT(r.id) AS resultCount,ROUND(AVG(r.score),1) AS averageScore FROM assessments a LEFT JOIN assessment_results r ON r.assessment_id=a.id WHERE a.class_id=? GROUP BY a.id ORDER BY a.date DESC LIMIT 6").bind(id).all(),
    env.DB.prepare("SELECT r.student_id AS studentId,r.weak_knowledge AS weakKnowledge FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE a.class_id=? AND COALESCE(r.weak_knowledge,'')<>''").bind(id).all(),
  ]);
  const rate = (source: Record<string, number> | null) => source && source.total ? Math.round(Number(source.done || 0) / Number(source.total) * 100) : null;
  const weak = new Map<string, Set<number>>();
  for (const source of weakRows.results as Array<Record<string, unknown>>) {
    const studentId = Number(source.studentId);
    if (!Number.isFinite(studentId) || studentId <= 0) continue;
    for (const item of String(source.weakKnowledge || "").split(/[,，、;；\n]/).map((entry) => entry.trim()).filter(Boolean)) {
      const studentIds = weak.get(item) || new Set<number>();
      studentIds.add(studentId);
      weak.set(item, studentIds);
    }
  }
  const weakKnowledge = [...weak.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 6)
    .map(([name, students]) => ({ name, count: students.size }));
  return Response.json({ class: row, members, lessons: lessonRows, assessments: assessmentRows.results, weakKnowledge, attendanceRate: rate(attendance), homeworkRate: rate(homework) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>, name = value(payload.name), stage = value(payload.stage), grade = value(payload.grade);
  if (!name || !stage || !grade) return Response.json({ error: "班级名称、学段、年级为必填项" }, { status: 400 });
  if (name.length > 80) return Response.json({ error: "班级名称不超过 80 个字符" }, { status: 400 });
  const status = payload.status === "archived" ? "archived" : "active";
  const [row] = await getDb().update(classes).set({ name, stage, grade, courseType: value(payload.courseType), startDate: value(payload.startDate) || null, schedule: value(payload.schedule), notes: value(payload.notes), status, archivedAt: status === "archived" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(classes.id, id)).returning();
  await audit(access, status === "archived" ? "archive" : "update", "class", id);
  return row ? Response.json({ class: row }) : Response.json({ error: "班级不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>, status = payload.status === "archived" ? "archived" : payload.status === "active" ? "active" : "";
  if (!status) return Response.json({ error: "班级状态无效" }, { status: 400 });
  const [row] = await getDb().update(classes).set({ status, archivedAt: status === "archived" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(classes.id, id)).returning();
  if (!row) return Response.json({ error: "班级不存在" }, { status: 404 });
  await audit(access, status === "archived" ? "archive" : "restore", "class", id);
  return Response.json({ class: row });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as { studentId: number }, studentId = Number(payload.studentId);
  if (!Number.isFinite(studentId) || studentId <= 0) return Response.json({ error: "请选择有效的学生" }, { status: 400 });
  const studentDenied = await requireStudentAccess(access, studentId); if (studentDenied) return studentDenied;
  const [student] = await getDb().select({ status: students.status }).from(students).where(eq(students.id, studentId)).limit(1);
  if (!student || student.status !== "active") return Response.json({ error: "仅可加入进行中的学生" }, { status: 409 });
  await getDb().insert(enrollments).values({ classId: id, studentId }).onConflictDoUpdate({ target: [enrollments.classId, enrollments.studentId], set: { status: "active" } });
  await audit(access, "link", "enrollment", `${id}:${studentId}`);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireClassAccess(access, id); if (denied) return denied;
  const payload = await request.json() as { studentId: number }, studentId = Number(payload.studentId);
  if (!Number.isFinite(studentId) || studentId <= 0) return Response.json({ error: "请选择有效的学生" }, { status: 400 });
  const studentDenied = await requireStudentAccess(access, studentId); if (studentDenied) return studentDenied;
  const [removed] = await getDb().update(enrollments).set({ status: "inactive" }).where(and(eq(enrollments.classId, id), eq(enrollments.studentId, studentId), eq(enrollments.status, "active"))).returning();
  if (!removed) return Response.json({ error: "学生不在当前班级" }, { status: 404 });
  await audit(access, "unlink", "enrollment", `${id}:${studentId}`);
  return Response.json({ ok: true });
}
