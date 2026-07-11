import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const lessonId = await idFrom(context), denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const [members, assignments, feedback, reflections, questionRows] = await Promise.all([
    env.DB.prepare("SELECT s.id,s.name,s.grade,a.status AS attendanceStatus,a.notes AS attendanceNote,r.participation,r.understanding,r.completion,r.teacher_note AS teacherNote,r.risk_tags AS riskTags,r.risk_confirmed AS riskConfirmed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' JOIN students s ON s.id=e.student_id LEFT JOIN attendance a ON a.lesson_id=l.id AND a.student_id=s.id LEFT JOIN student_lesson_records r ON r.lesson_id=l.id AND r.student_id=s.id WHERE l.id=? ORDER BY s.name").bind(lessonId).all(),
    env.DB.prepare("SELECT * FROM assignments WHERE lesson_id=? ORDER BY created_at DESC").bind(lessonId).all(),
    env.DB.prepare("SELECT f.*,s.name AS studentName FROM feedback f LEFT JOIN students s ON s.id=f.student_id WHERE f.lesson_id=? ORDER BY f.created_at DESC").bind(lessonId).all(),
    access.role === "teacher" ? env.DB.prepare("SELECT * FROM reflections WHERE lesson_id=? ORDER BY created_at DESC").bind(lessonId).all() : Promise.resolve({ results: [] }),
    env.DB.prepare("SELECT q.id,q.stem,q.question_type AS questionType,q.difficulty,q.score,lq.purpose FROM lesson_questions lq JOIN questions q ON q.id=lq.question_id WHERE lq.lesson_id=? ORDER BY lq.position,q.id").bind(lessonId).all(),
  ]);
  return Response.json({ members: members.results, assignments: assignments.results, feedback: feedback.results, reflections: reflections.results, questions: questionRows.results });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const lessonId = await idFrom(context), denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const payload = await request.json() as Record<string, unknown>;
  if (payload.action === "studentRecord") {
    const studentId = Number(payload.studentId), member = await env.DB.prepare("SELECT 1 AS allowed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.student_id=? AND e.status='active' WHERE l.id=?").bind(studentId, lessonId).first();
    if (!member) return Response.json({ error: "该学生不属于当前课时班级" }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attendance (lesson_id,student_id,status,notes) VALUES (?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,notes=excluded.notes").bind(lessonId, studentId, String(payload.attendanceStatus || "present"), String(payload.attendanceNote || "")),
      env.DB.prepare("INSERT INTO student_lesson_records (lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET participation=excluded.participation,understanding=excluded.understanding,completion=excluded.completion,teacher_note=excluded.teacher_note,risk_tags=excluded.risk_tags,risk_confirmed=excluded.risk_confirmed,updated_at=CURRENT_TIMESTAMP").bind(lessonId, studentId, Number(payload.participation || 0) || null, Number(payload.understanding || 0) || null, Number(payload.completion || 0) || null, String(payload.teacherNote || ""), String(payload.riskTags || ""), payload.riskConfirmed ? 1 : 0),
    ]);
    await audit(access, "update", "student_lesson_record", `${lessonId}:${studentId}`, { riskConfirmed: Boolean(payload.riskConfirmed) });
    return Response.json({ ok: true });
  }
  if (payload.action === "assignment") {
    const result = await env.DB.prepare("INSERT INTO assignments (lesson_id,title,requirements,due_at) VALUES (?,?,?,?) RETURNING id").bind(lessonId, String(payload.title || "课后作业"), String(payload.requirements || ""), String(payload.dueAt || "")).first<{ id: number }>();
    if (result) { const members = await env.DB.prepare("SELECT e.student_id AS id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' WHERE l.id=?").bind(lessonId).all<{ id: number }>(); if (members.results.length) await env.DB.batch(members.results.map((member) => env.DB.prepare("INSERT INTO assignment_submissions (assignment_id,student_id,status) VALUES (?,?,'pending')").bind(result.id, member.id))); await audit(access, "create", "assignment", result.id, { lessonId }); }
    return Response.json({ ok: true });
  }
  if (payload.action === "feedback") {
    const studentId = payload.studentId ? Number(payload.studentId) : null;
    if (studentId) { const member = await env.DB.prepare("SELECT 1 AS allowed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.student_id=? AND e.status='active' WHERE l.id=?").bind(studentId, lessonId).first(); if (!member) return Response.json({ error: "该学生不属于当前课时班级" }, { status: 400 }); }
    const result = await env.DB.prepare("INSERT INTO feedback (lesson_id,student_id,class_id,type,tone,content,status) SELECT id,?,class_id,?,?,?,'draft' FROM lessons WHERE id=? RETURNING id").bind(studentId, String(payload.type || "lesson"), String(payload.tone || "专业简洁"), String(payload.content || ""), lessonId).first<{ id: number }>();
    await audit(access, "create", "feedback", result?.id, { lessonId, status: "draft" });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
