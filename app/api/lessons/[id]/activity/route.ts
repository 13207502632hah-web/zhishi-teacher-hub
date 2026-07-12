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
  if (payload.action === "completeLesson") {
    const records = Array.isArray(payload.records) ? payload.records.slice(0, 100) as Array<Record<string, unknown>> : [], members = await env.DB.prepare("SELECT e.student_id AS id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' WHERE l.id=?").bind(lessonId).all<{ id: number }>(), allowed = new Set(members.results.map((item) => Number(item.id))), statements = [env.DB.prepare("UPDATE lessons SET actual_content=?,homework=?,next_plan=?,participation=?,understanding=?,completion=?,discipline=?,status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(payload.actualContent || ""), String(payload.homework || ""), String(payload.nextPlan || ""), Number(payload.participation || 0) || null, Number(payload.understanding || 0) || null, Number(payload.completion || 0) || null, Number(payload.discipline || 0) || null, lessonId)];
    for (const record of records) {
      const studentId = Number(record.studentId); if (!allowed.has(studentId)) return Response.json({ error: "课堂记录包含不属于当前班级的学生" }, { status: 400 });
      statements.push(env.DB.prepare("INSERT INTO attendance(lesson_id,student_id,status,notes) VALUES(?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,notes=excluded.notes").bind(lessonId, studentId, String(record.attendanceStatus || "present"), String(record.attendanceNote || "")));
      statements.push(env.DB.prepare("INSERT INTO student_lesson_records(lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET participation=excluded.participation,understanding=excluded.understanding,completion=excluded.completion,teacher_note=excluded.teacher_note,risk_tags=excluded.risk_tags,risk_confirmed=excluded.risk_confirmed,updated_at=CURRENT_TIMESTAMP").bind(lessonId, studentId, Number(record.participation || 0) || null, Number(record.understanding || 0) || null, Number(record.completion || 0) || null, String(record.teacherNote || ""), String(record.riskTags || ""), record.riskConfirmed ? 1 : 0));
    }
    await env.DB.batch(statements);
    const assignment = payload.assignment as Record<string, unknown> | undefined, title = String(assignment?.title || "").trim();
    if (title) { let saved = await env.DB.prepare("SELECT id FROM assignments WHERE lesson_id=? AND title=? LIMIT 1").bind(lessonId, title).first<{ id: number }>(); if (!saved) saved = await env.DB.prepare("INSERT INTO assignments(lesson_id,title,requirements,due_at) VALUES(?,?,?,?) RETURNING id").bind(lessonId, title, String(assignment?.requirements || ""), String(assignment?.dueAt || "")).first<{ id: number }>(); if (saved && members.results.length) await env.DB.batch(members.results.map((member) => env.DB.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status) SELECT ?,?,'pending' WHERE NOT EXISTS(SELECT 1 FROM assignment_submissions WHERE assignment_id=? AND student_id=?)").bind(saved.id, member.id, saved.id, member.id))); }
    const feedback = payload.feedback as Record<string, unknown> | undefined, content = String(feedback?.content || "").trim(), studentId = feedback?.studentId ? Number(feedback.studentId) : null;
    if (content) await env.DB.prepare("INSERT INTO feedback(lesson_id,student_id,class_id,type,tone,content,learning_content,homework_requirements,next_focus,status) SELECT l.id,?,l.class_id,'lesson',?,?,l.actual_content,l.homework,l.next_plan,'draft' FROM lessons l WHERE l.id=? AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.lesson_id=l.id AND COALESCE(f.student_id,0)=COALESCE(?,0) AND f.content=?)").bind(studentId, String(feedback?.tone || "专业简洁"), content, lessonId, studentId, content).run();
    await audit(access, "complete", "lesson", lessonId, { students: records.length, assignment: Boolean(title), feedback: Boolean(content) });
    return Response.json({ ok: true, status: "completed" });
  }
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
