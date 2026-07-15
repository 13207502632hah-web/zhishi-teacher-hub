import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";
import { completionTodos, explicitAttendanceStatuses, resolveLessonFinance, validateLessonCompletion } from "../../../../lib/lesson-workflow";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const rating = (value: unknown) => { const number = Number(value || 0); return number >= 1 && number <= 5 ? number : null; };

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const lessonId = await idFrom(context), denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const [members, assignments, feedback, reflections, questionRows, finance] = await Promise.all([
    env.DB.prepare("SELECT s.id,s.name,s.grade,a.status AS attendanceStatus,a.notes AS attendanceNote,r.participation,r.understanding,r.completion,r.teacher_note AS teacherNote,r.risk_tags AS riskTags,r.risk_confirmed AS riskConfirmed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' JOIN students s ON s.id=e.student_id LEFT JOIN attendance a ON a.lesson_id=l.id AND a.student_id=s.id LEFT JOIN student_lesson_records r ON r.lesson_id=l.id AND r.student_id=s.id WHERE l.id=? ORDER BY s.name").bind(lessonId).all(),
    env.DB.prepare("SELECT * FROM assignments WHERE lesson_id=? ORDER BY created_at DESC").bind(lessonId).all(),
    env.DB.prepare("SELECT f.*,s.name AS studentName FROM feedback f LEFT JOIN students s ON s.id=f.student_id WHERE f.lesson_id=? ORDER BY f.created_at DESC").bind(lessonId).all(),
    access.role === "teacher" ? env.DB.prepare("SELECT * FROM reflections WHERE lesson_id=? ORDER BY created_at DESC").bind(lessonId).all() : Promise.resolve({ results: [] }),
    env.DB.prepare("SELECT q.id,q.stem,q.question_type AS questionType,q.difficulty,q.score,lq.purpose FROM lesson_questions lq JOIN questions q ON q.id=lq.question_id WHERE lq.lesson_id=? ORDER BY lq.position,q.id").bind(lessonId).all(),
    env.DB.prepare("SELECT id,status,expected_amount AS expectedAmount,note FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first(),
  ]);
  return Response.json({ members: members.results, assignments: assignments.results, feedback: feedback.results, reflections: reflections.results, questions: questionRows.results, finance });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const lessonId = await idFrom(context), denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const payload = await request.json() as Record<string, any>, action = String(payload.action || "");

  if (["saveDraft", "completeLesson"].includes(action)) {
    const lesson = await env.DB.prepare("SELECT id,date,fee,status FROM lessons WHERE id=?").bind(lessonId).first<{ id: number; date: string; fee: number | null; status: string }>();
    if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
    const memberRows = await env.DB.prepare("SELECT e.student_id AS id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' WHERE l.id=? ORDER BY e.student_id").bind(lessonId).all<{ id: number }>();
    const memberIds = memberRows.results.map((item) => Number(item.id)), allowed = new Set(memberIds);
    const records = (Array.isArray(payload.records) ? payload.records.slice(0, 100) : []) as Array<{ studentId: number; attendanceStatus?: string; [key: string]: any }>;
    if (records.some((record) => !allowed.has(Number(record.studentId)))) return Response.json({ error: "课堂记录包含不属于当前班级的学生" }, { status: 400 });
    if (action === "completeLesson") {
      const errors = validateLessonCompletion(payload.actualContent, memberIds, records);
      if (errors.length) return Response.json({ error: errors[0], errors }, { status: 422 });
    }

    const statements = [] as ReturnType<typeof env.DB.prepare>[];
    statements.push(env.DB.prepare(`UPDATE lessons SET actual_content=?,homework=?,next_plan=?,participation=?,understanding=?,completion=?,discipline=?,${action === "completeLesson" ? "status='completed'," : ""}updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      String(payload.actualContent || ""), String(payload.homework || ""), String(payload.nextPlan || ""), rating(payload.participation), rating(payload.understanding), rating(payload.completion), rating(payload.discipline), lessonId,
    ));
    for (const record of records) {
      const studentId = Number(record.studentId), attendanceStatus = String(record.attendanceStatus || "");
      if (explicitAttendanceStatuses.includes(attendanceStatus as any)) statements.push(env.DB.prepare("INSERT INTO attendance(lesson_id,student_id,status,notes) VALUES(?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,notes=excluded.notes").bind(lessonId, studentId, attendanceStatus, String(record.attendanceNote || "")));
      statements.push(env.DB.prepare("INSERT INTO student_lesson_records(lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET participation=excluded.participation,understanding=excluded.understanding,completion=excluded.completion,teacher_note=excluded.teacher_note,risk_tags=excluded.risk_tags,risk_confirmed=excluded.risk_confirmed,updated_at=CURRENT_TIMESTAMP").bind(lessonId, studentId, rating(record.participation), rating(record.understanding), rating(record.completion), String(record.teacherNote || ""), String(record.riskTags || ""), record.riskConfirmed ? 1 : 0));
    }

    const assignment = payload.assignment as Record<string, unknown> | undefined, assignmentTitle = String(assignment?.title || "").trim();
    const feedback = payload.feedback as Record<string, unknown> | undefined, feedbackContent = String(feedback?.content || "").trim(), feedbackStudentId = feedback?.studentId ? Number(feedback.studentId) : null;
    let financeLocked = false;
    if (action === "completeLesson") {
      if (assignmentTitle) {
        statements.push(env.DB.prepare("UPDATE assignments SET requirements=?,due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1) AND status='draft'").bind(String(assignment?.requirements || ""), String(assignment?.dueAt || ""), lessonId, assignmentTitle));
        statements.push(env.DB.prepare("INSERT INTO assignments(lesson_id,title,requirements,due_at,status) SELECT ?,?,?,?,'draft' WHERE NOT EXISTS(SELECT 1 FROM assignments WHERE lesson_id=? AND title=?)").bind(lessonId, assignmentTitle, String(assignment?.requirements || ""), String(assignment?.dueAt || ""), lessonId, assignmentTitle));
        for (const memberId of memberIds) statements.push(env.DB.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status) SELECT (SELECT id FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1),?,'pending' WHERE NOT EXISTS(SELECT 1 FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.lesson_id=? AND a.title=? AND s.student_id=?)").bind(lessonId, assignmentTitle, memberId, lessonId, assignmentTitle, memberId));
      }
      if (feedbackContent) {
        statements.push(env.DB.prepare("UPDATE feedback SET tone=?,content=?,learning_content=?,homework_requirements=?,next_focus=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM feedback WHERE lesson_id=? AND COALESCE(student_id,0)=COALESCE(?,0) AND status='draft' ORDER BY id DESC LIMIT 1)").bind(String(feedback?.tone || "专业简洁"), feedbackContent, String(payload.actualContent || ""), String(payload.homework || ""), String(payload.nextPlan || ""), lessonId, feedbackStudentId));
        statements.push(env.DB.prepare("INSERT INTO feedback(lesson_id,student_id,class_id,type,tone,content,learning_content,homework_requirements,next_focus,status) SELECT l.id,?,l.class_id,'lesson',?,?,?,?,?,'draft' FROM lessons l WHERE l.id=? AND NOT EXISTS(SELECT 1 FROM feedback f WHERE f.lesson_id=l.id AND COALESCE(f.student_id,0)=COALESCE(?,0))").bind(feedbackStudentId, String(feedback?.tone || "专业简洁"), feedbackContent, String(payload.actualContent || ""), String(payload.homework || ""), String(payload.nextPlan || ""), lessonId, feedbackStudentId));
      }

      const [existingFinance, importRow, pricingRows] = await Promise.all([
        env.DB.prepare("SELECT id,payer_type AS payerType,payer_id AS payerId,base_fee AS baseFee,expected_amount AS expectedAmount,status FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<Record<string, any>>(),
        env.DB.prepare("SELECT normalized_data AS normalizedData FROM schedule_import_rows WHERE lesson_id=? ORDER BY id DESC LIMIT 1").bind(lessonId).first<{ normalizedData: string }>(),
        env.DB.prepare("SELECT id,institution_id AS institutionId,student_id AS studentId,payer_type AS payerType,base_fee AS baseFee,per_student_fee AS perStudentFee,unit_price AS unitPrice,effective_from AS effectiveFrom,effective_to AS effectiveTo FROM pricing_rules WHERE status='active' AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?) ORDER BY COALESCE(effective_from,'') DESC,id DESC").bind(lesson.date, lesson.date).all<Record<string, any>>(),
      ]);
      financeLocked = Boolean(existingFinance && existingFinance.status !== "review");
      if (!financeLocked) {
        let imported: Record<string, unknown> | null = null;
        try { imported = importRow?.normalizedData ? JSON.parse(importRow.normalizedData) : null; } catch { imported = null; }
        const recordByStudent = new Map(records.map((record) => [Number(record.studentId), String(record.attendanceStatus || "")]));
        const financePlan = resolveLessonFinance({ date: lesson.date, lessonFee: lesson.fee, imported, existing: existingFinance, rules: pricingRows.results, members: memberIds.map((studentId) => ({ studentId, attendanceStatus: recordByStudent.get(studentId) })) });
        statements.push(env.DB.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,status,note) SELECT ?,?,?,?,?,?,'review',? WHERE NOT EXISTS(SELECT 1 FROM lesson_finance WHERE lesson_id=?)").bind(lessonId, financePlan.payerType, financePlan.payerId, financePlan.baseFee, 0, financePlan.expectedAmount, financePlan.note, lessonId));
        statements.push(env.DB.prepare("UPDATE lesson_finance SET payer_type=?,payer_id=?,base_fee=?,adjustment=0,expected_amount=?,status='review',note=?,updated_at=CURRENT_TIMESTAMP WHERE lesson_id=? AND status='review'").bind(financePlan.payerType, financePlan.payerId, financePlan.baseFee, financePlan.expectedAmount, financePlan.note, lessonId));
        statements.push(env.DB.prepare("DELETE FROM lesson_billing_items WHERE lesson_finance_id=(SELECT id FROM lesson_finance WHERE lesson_id=? AND status='review')").bind(lessonId));
        for (const item of financePlan.items) statements.push(env.DB.prepare("INSERT INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) SELECT id,?,?,?,?,?,? FROM lesson_finance WHERE lesson_id=? AND status='review'").bind(item.studentId, item.status, item.factor, item.unitFee, item.amount, item.factor === 0 ? "缺勤或请假，待核对" : null, lessonId));
      }
    }

    await env.DB.batch(statements);
    const todos = completionTodos({ assignment: Boolean(assignmentTitle), feedback: Boolean(feedbackContent), nextPlan: payload.nextPlan });
    if (action === "saveDraft") {
      await audit(access, "save_draft", "lesson", lessonId, { students: records.length });
      return Response.json({ ok: true, status: lesson.status, todos });
    }
    const [savedAssignment, savedFeedback, savedFinance] = await Promise.all([
      assignmentTitle ? env.DB.prepare("SELECT id FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1").bind(lessonId, assignmentTitle).first<{ id: number }>() : null,
      feedbackContent ? env.DB.prepare("SELECT id,status FROM feedback WHERE lesson_id=? AND COALESCE(student_id,0)=COALESCE(?,0) ORDER BY id DESC LIMIT 1").bind(lessonId, feedbackStudentId).first<{ id: number; status: string }>() : null,
      env.DB.prepare("SELECT id,status,expected_amount AS expectedAmount,note FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<Record<string, unknown>>(),
    ]);
    await audit(access, "complete", "lesson", lessonId, { students: records.length, assignment: Boolean(assignmentTitle), feedback: Boolean(feedbackContent), financeLocked, todos });
    return Response.json({ ok: true, status: "completed", artifacts: { assignmentId: savedAssignment?.id || null, feedbackId: savedFeedback?.id || null, financeId: savedFinance?.id || null, financeStatus: savedFinance?.status || null, financeLocked }, todos });
  }

  if (action === "studentRecord") {
    const studentId = Number(payload.studentId), member = await env.DB.prepare("SELECT 1 AS allowed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.student_id=? AND e.status='active' WHERE l.id=?").bind(studentId, lessonId).first();
    if (!member) return Response.json({ error: "该学生不属于当前课时班级" }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attendance(lesson_id,student_id,status,notes) VALUES(?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,notes=excluded.notes").bind(lessonId, studentId, String(payload.attendanceStatus || "present"), String(payload.attendanceNote || "")),
      env.DB.prepare("INSERT INTO student_lesson_records(lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET participation=excluded.participation,understanding=excluded.understanding,completion=excluded.completion,teacher_note=excluded.teacher_note,risk_tags=excluded.risk_tags,risk_confirmed=excluded.risk_confirmed,updated_at=CURRENT_TIMESTAMP").bind(lessonId, studentId, rating(payload.participation), rating(payload.understanding), rating(payload.completion), String(payload.teacherNote || ""), String(payload.riskTags || ""), payload.riskConfirmed ? 1 : 0),
    ]);
    await audit(access, "update", "student_lesson_record", `${lessonId}:${studentId}`, { riskConfirmed: Boolean(payload.riskConfirmed) });
    return Response.json({ ok: true });
  }
  if (action === "assignment") {
    const result = await env.DB.prepare("INSERT INTO assignments(lesson_id,title,requirements,due_at) VALUES(?,?,?,?) RETURNING id").bind(lessonId, String(payload.title || "课后作业"), String(payload.requirements || ""), String(payload.dueAt || "")).first<{ id: number }>();
    if (result) { const members = await env.DB.prepare("SELECT e.student_id AS id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' WHERE l.id=?").bind(lessonId).all<{ id: number }>(); if (members.results.length) await env.DB.batch(members.results.map((member) => env.DB.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,'pending')").bind(result.id, member.id))); await audit(access, "create", "assignment", result.id, { lessonId }); }
    return Response.json({ ok: true });
  }
  if (action === "feedback") {
    const studentId = payload.studentId ? Number(payload.studentId) : null;
    if (studentId) { const member = await env.DB.prepare("SELECT 1 AS allowed FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.student_id=? AND e.status='active' WHERE l.id=?").bind(studentId, lessonId).first(); if (!member) return Response.json({ error: "该学生不属于当前课时班级" }, { status: 400 }); }
    const result = await env.DB.prepare("INSERT INTO feedback(lesson_id,student_id,class_id,type,tone,content,status) SELECT id,?,class_id,?,?,?,'draft' FROM lessons WHERE id=? RETURNING id").bind(studentId, String(payload.type || "lesson"), String(payload.tone || "专业简洁"), String(payload.content || ""), lessonId).first<{ id: number }>();
    await audit(access, "create", "feedback", result?.id, { lessonId, status: "draft" });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "不支持的操作" }, { status: 400 });
}
