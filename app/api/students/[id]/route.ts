import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { students } from "../../../../db/schema";
import { audit, isDenied, requirePermission, requireStudentAccess } from "../../../lib/access";

const value = (input: unknown) => String(input || "").trim();
const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const db = getDb(), [student] = await db.select({ id: students.id, name: students.name, nickname: students.nickname, grade: students.grade, school: students.school, textbookVersion: students.textbookVersion, subjectChoice: students.subjectChoice, examGoal: students.examGoal, foundationLevel: students.foundationLevel, strengths: students.strengths, weakKnowledge: students.weakKnowledge, learningHabits: students.learningHabits, stageGoal: students.stageGoal, riskTags: students.riskTags, riskConfirmed: students.riskConfirmed, status: students.status, notes: students.notes, createdAt: students.createdAt, updatedAt: students.updatedAt }).from(students).where(eq(students.id, id)).limit(1);
  if (!student) return Response.json({ error: "学生不存在" }, { status: 404 });
  const [lessonRecords, submissions, feedbackRows, results] = await Promise.all([
    env.DB.prepare("SELECT r.*,l.date,l.course_name AS courseName,l.topic FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.student_id=? ORDER BY l.date DESC").bind(id).all(),
    env.DB.prepare("SELECT s.*,a.title,a.due_at AS dueAt,l.date AS lessonDate FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE s.student_id=? ORDER BY a.created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT f.*,l.date AS lessonDate,l.topic FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.student_id=? ORDER BY f.created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT r.*,a.title,a.date FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE r.student_id=? ORDER BY a.date DESC").bind(id).all(),
  ]);
  return Response.json({ student, lessonRecords: lessonRecords.results, submissions: submissions.results, feedback: feedbackRows.results, results: results.results });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>, name = value(payload.name), grade = value(payload.grade);
  if (!name || !grade) return Response.json({ error: "姓名与年级为必填项" }, { status: 400 });
  const status = payload.status === "archived" ? "archived" : "active";
  const updates: Record<string, unknown> = { name, nickname: value(payload.nickname), grade, school: value(payload.school), textbookVersion: value(payload.textbookVersion), subjectChoice: value(payload.subjectChoice), examGoal: value(payload.examGoal), foundationLevel: value(payload.foundationLevel), strengths: value(payload.strengths), weakKnowledge: value(payload.weakKnowledge), learningHabits: value(payload.learningHabits), stageGoal: value(payload.stageGoal), riskTags: value(payload.riskTags), riskConfirmed: payload.riskConfirmed === true || payload.riskConfirmed === "true", status, archivedAt: status === "archived" ? new Date().toISOString() : null, notes: value(payload.notes), updatedAt: new Date().toISOString() };
  if ("guardianContact" in payload) updates.guardianContact = value(payload.guardianContact);
  const [row] = await getDb().update(students).set(updates).where(eq(students.id, id)).returning();
  await audit(access, status === "archived" ? "archive" : "update", "student", id);
  return row ? Response.json({ student: row }) : Response.json({ error: "学生不存在" }, { status: 404 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const [row] = await getDb().update(students).set({ status: "archived", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(students.id, id)).returning();
  await audit(access, "archive", "student", id);
  return row ? Response.json({ ok: true }) : Response.json({ error: "学生不存在" }, { status: 404 });
}
