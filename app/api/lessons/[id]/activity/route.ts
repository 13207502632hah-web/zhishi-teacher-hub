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

  if (action === "undoLatestCompletion") {
    const run = await env.DB.prepare("SELECT id,before_snapshot AS beforeSnapshot,artifact_snapshot AS artifactSnapshot,completed_at AS completedAt FROM lesson_completion_runs WHERE lesson_id=? AND status='active' AND datetime(completed_at)>=datetime('now','-24 hours') ORDER BY completed_at DESC LIMIT 1").bind(lessonId).first<Record<string, any>>();
    if (!run) return Response.json({ error: "没有可撤销的24小时内完成记录" }, { status: 409 });
    let before: Record<string, any> = {}, artifacts: Record<string, any> = {}; try { before = JSON.parse(String(run.beforeSnapshot || "{}")); artifacts = JSON.parse(String(run.artifactSnapshot || "{}")); } catch { return Response.json({ error: "撤销快照损坏，已停止操作以保护现有数据" }, { status: 409 }); }
    const blockers: string[] = [];
    const assignment = artifacts.assignment?.id ? await env.DB.prepare("SELECT id,status,requirements,due_at AS dueAt,updated_at AS updatedAt,(SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id=assignments.id AND s.status!='pending') AS actedCount,(SELECT COUNT(*) FROM submission_versions sv JOIN assignment_submissions s ON s.id=sv.submission_id WHERE s.assignment_id=assignments.id) AS versionCount FROM assignments WHERE id=?").bind(artifacts.assignment.id).first<Record<string, any>>() : null;
    const feedback = artifacts.feedback?.id ? await env.DB.prepare("SELECT id,status,sent_at AS sentAt,updated_at AS updatedAt FROM feedback WHERE id=?").bind(artifacts.feedback.id).first<Record<string, any>>() : null;
    const finance = artifacts.finance?.id ? await env.DB.prepare("SELECT id,status,updated_at AS updatedAt FROM lesson_finance WHERE id=?").bind(artifacts.finance.id).first<Record<string, any>>() : null;
    if (assignment && (assignment.status !== "draft" || Number(assignment.actedCount) > 0 || Number(assignment.versionCount) > 0 || (artifacts.assignment.afterUpdatedAt && assignment.updatedAt !== artifacts.assignment.afterUpdatedAt))) blockers.push("作业已发布、已有学生操作或被后续修改");
    if (feedback && (feedback.status !== "draft" || feedback.sentAt || (artifacts.feedback.afterUpdatedAt && feedback.updatedAt !== artifacts.feedback.afterUpdatedAt))) blockers.push("反馈已确认、已发送或被后续修改");
    if (finance && (finance.status !== "review" || (artifacts.finance.afterUpdatedAt && finance.updatedAt !== artifacts.finance.afterUpdatedAt))) blockers.push("财务记录已确认或被后续修改");
    if (blockers.length) return Response.json({ error: "存在受保护产物，本次撤销未执行", blockers }, { status: 409 });
    const statements = [env.DB.prepare("UPDATE lessons SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(before.lessonStatus || "scheduled"), lessonId)];
    if (assignment && artifacts.assignment.created) statements.push(
      env.DB.prepare("DELETE FROM assignment_assets WHERE assignment_id=?").bind(assignment.id), env.DB.prepare("DELETE FROM assignment_targets WHERE assignment_id=?").bind(assignment.id), env.DB.prepare("DELETE FROM assignment_settings WHERE assignment_id=?").bind(assignment.id), env.DB.prepare("DELETE FROM assignment_submissions WHERE assignment_id=?").bind(assignment.id), env.DB.prepare("DELETE FROM assignments WHERE id=?").bind(assignment.id),
    );
    else if (assignment && artifacts.assignment.before) {
      const originalStudents = (artifacts.assignment.before.submissionStudentIds || []).map(Number).filter((value: number) => value > 0);
      if (originalStudents.length) statements.push(env.DB.prepare(`DELETE FROM assignment_submissions WHERE assignment_id=? AND status='pending' AND student_id NOT IN (${originalStudents.map(() => "?").join(",")})`).bind(assignment.id, ...originalStudents));
      else statements.push(env.DB.prepare("DELETE FROM assignment_submissions WHERE assignment_id=? AND status='pending'").bind(assignment.id));
      statements.push(env.DB.prepare("UPDATE assignments SET requirements=?,due_at=?,status=?,updated_at=? WHERE id=?").bind(artifacts.assignment.before.requirements || null, artifacts.assignment.before.dueAt || null, artifacts.assignment.before.status || "draft", artifacts.assignment.before.updatedAt, assignment.id));
    }
    if (feedback && artifacts.feedback.created) statements.push(env.DB.prepare("DELETE FROM feedback_evidence WHERE feedback_id=?").bind(feedback.id), env.DB.prepare("DELETE FROM feedback WHERE id=?").bind(feedback.id));
    else if (feedback && artifacts.feedback.before) statements.push(env.DB.prepare("UPDATE feedback SET tone=?,content=?,learning_content=?,homework_requirements=?,next_focus=?,status=?,updated_at=? WHERE id=?").bind(artifacts.feedback.before.tone || null, artifacts.feedback.before.content || "", artifacts.feedback.before.learningContent || null, artifacts.feedback.before.homeworkRequirements || null, artifacts.feedback.before.nextFocus || null, artifacts.feedback.before.status || "draft", artifacts.feedback.before.updatedAt, feedback.id));
    if (finance && artifacts.finance.created) statements.push(env.DB.prepare("DELETE FROM lesson_billing_items WHERE lesson_finance_id=?").bind(finance.id), env.DB.prepare("DELETE FROM lesson_finance WHERE id=?").bind(finance.id));
    else if (finance && artifacts.finance.before) {
      statements.push(env.DB.prepare("DELETE FROM lesson_billing_items WHERE lesson_finance_id=?").bind(finance.id), env.DB.prepare("UPDATE lesson_finance SET payer_type=?,payer_id=?,base_fee=?,adjustment=?,expected_amount=?,received_amount=?,status=?,note=?,pricing_rule_id=?,calculation_snapshot=?,updated_at=? WHERE id=?").bind(artifacts.finance.before.payerType, artifacts.finance.before.payerId || null, artifacts.finance.before.baseFee || 0, artifacts.finance.before.adjustment || 0, artifacts.finance.before.expectedAmount || 0, artifacts.finance.before.receivedAmount || 0, artifacts.finance.before.status || "review", artifacts.finance.before.note || null, artifacts.finance.before.pricingRuleId || null, artifacts.finance.before.calculationSnapshot || null, artifacts.finance.before.updatedAt, finance.id));
      for (const item of artifacts.finance.before.billingItems || []) statements.push(env.DB.prepare("INSERT INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) VALUES(?,?,?,?,?,?,?)").bind(finance.id, item.studentId, item.attendanceStatus, item.billingFactor, item.unitFee, item.amount, item.reason || null));
    }
    statements.push(env.DB.prepare("UPDATE lesson_completion_runs SET status='undone',undone_at=CURRENT_TIMESTAMP WHERE id=?").bind(run.id));
    await env.DB.batch(statements); await audit(access, "undo_complete", "lesson", lessonId, { runId: run.id }); return Response.json({ ok: true, runId: run.id });
  }

  if (["saveDraft", "completeLesson"].includes(action)) {
    const lesson = await env.DB.prepare("SELECT id,class_id AS classId,date,fee,status,next_plan AS nextPlan FROM lessons WHERE id=?").bind(lessonId).first<{ id: number; classId: number | null; date: string; fee: number | null; status: string; nextPlan: string | null }>();
    if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
    const memberRows = await env.DB.prepare("SELECT e.student_id AS id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' WHERE l.id=? ORDER BY e.student_id").bind(lessonId).all<{ id: number }>();
    const memberIds = memberRows.results.map((item) => Number(item.id)), allowed = new Set(memberIds);
    const records = (Array.isArray(payload.records) ? payload.records.slice(0, 100) : []) as Array<{ studentId: number; attendanceStatus?: string; [key: string]: any }>;
    if (records.some((record) => !allowed.has(Number(record.studentId)))) return Response.json({ error: "课堂记录包含不属于当前班级的学生" }, { status: 400 });
    if (action === "completeLesson") {
      const errors = validateLessonCompletion(payload.actualContent, memberIds, records);
      if (errors.length) return Response.json({ error: errors[0], errors }, { status: 422 });
      if (lesson.status === "completed") {
        const [savedAssignment, savedFeedback, savedFinance] = await Promise.all([
          env.DB.prepare("SELECT id,status FROM assignments WHERE lesson_id=? ORDER BY updated_at DESC,id DESC LIMIT 1").bind(lessonId).first<Record<string, any>>(),
          env.DB.prepare("SELECT id,status FROM feedback WHERE lesson_id=? ORDER BY updated_at DESC,id DESC LIMIT 1").bind(lessonId).first<Record<string, any>>(),
          env.DB.prepare("SELECT id,status,expected_amount AS expectedAmount FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<Record<string, any>>(),
        ]);
        const todos = completionTodos({ assignment: Boolean(savedAssignment), feedback: Boolean(savedFeedback), nextPlan: lesson.nextPlan });
        await audit(access, "complete_idempotent", "lesson", lessonId, { todos });
        return Response.json({ ok: true, status: "completed", idempotent: true, completionRunId: null, artifacts: { assignmentId: savedAssignment?.id || null, feedbackId: savedFeedback?.id || null, financeId: savedFinance?.id || null, financeStatus: savedFinance?.status || null, financeLocked: Boolean(savedFinance && savedFinance.status !== "review") }, todos });
      }
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
    const runId = action === "completeLesson" ? crypto.randomUUID() : "";
    const [beforeAssignment, beforeFeedback, beforeFinance] = action === "completeLesson" ? await Promise.all([
      assignmentTitle ? env.DB.prepare("SELECT id,requirements,due_at AS dueAt,status,updated_at AS updatedAt FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1").bind(lessonId, assignmentTitle).first<Record<string, any>>() : null,
      feedbackContent ? env.DB.prepare("SELECT id,tone,content,learning_content AS learningContent,homework_requirements AS homeworkRequirements,next_focus AS nextFocus,status,updated_at AS updatedAt FROM feedback WHERE lesson_id=? AND COALESCE(student_id,0)=COALESCE(?,0) ORDER BY id DESC LIMIT 1").bind(lessonId, feedbackStudentId).first<Record<string, any>>() : null,
      env.DB.prepare("SELECT id,payer_type AS payerType,payer_id AS payerId,base_fee AS baseFee,adjustment,expected_amount AS expectedAmount,received_amount AS receivedAmount,status,note,pricing_rule_id AS pricingRuleId,calculation_snapshot AS calculationSnapshot,updated_at AS updatedAt FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<Record<string, any>>(),
    ]) : [null, null, null];
    if (beforeAssignment?.id) beforeAssignment.submissionStudentIds = (await env.DB.prepare("SELECT student_id AS studentId FROM assignment_submissions WHERE assignment_id=?").bind(beforeAssignment.id).all<{ studentId: number }>()).results.map((item) => Number(item.studentId));
    if (beforeFinance?.id) beforeFinance.billingItems = (await env.DB.prepare("SELECT student_id AS studentId,attendance_status AS attendanceStatus,billing_factor AS billingFactor,unit_fee AS unitFee,amount,reason FROM lesson_billing_items WHERE lesson_finance_id=? ORDER BY id").bind(beforeFinance.id).all()).results;
    if (action === "completeLesson") statements.push(env.DB.prepare("INSERT INTO lesson_completion_runs(id,lesson_id,actor_id,before_snapshot,artifact_snapshot,status) VALUES(?,?,?,?,?,'active')").bind(runId, lessonId, access.id, JSON.stringify({ lessonStatus: lesson.status }), JSON.stringify({ assignment: { before: beforeAssignment || null }, feedback: { before: beforeFeedback || null }, finance: { before: beforeFinance || null } })));
    let financeLocked = false;
    if (action === "completeLesson") {
      if (assignmentTitle) {
        statements.push(env.DB.prepare("UPDATE assignments SET requirements=?,due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1) AND status='draft'").bind(String(assignment?.requirements || ""), String(assignment?.dueAt || ""), lessonId, assignmentTitle));
        statements.push(env.DB.prepare("INSERT INTO assignments(lesson_id,class_id,title,requirements,due_at,status) SELECT ?,?,?,?,?,'draft' WHERE NOT EXISTS(SELECT 1 FROM assignments WHERE lesson_id=? AND title=?)").bind(lessonId, lesson.classId, assignmentTitle, String(assignment?.requirements || ""), String(assignment?.dueAt || ""), lessonId, assignmentTitle));
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO assignment_settings(assignment_id,allow_parent_submit,require_revision) SELECT id,1,1 FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1").bind(lessonId, assignmentTitle));
        if (lesson.classId) statements.push(env.DB.prepare("INSERT OR IGNORE INTO assignment_targets(assignment_id,target_type,target_id) SELECT id,'class',? FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1").bind(lesson.classId, lessonId, assignmentTitle));
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
      assignmentTitle ? env.DB.prepare("SELECT id,status,updated_at AS updatedAt FROM assignments WHERE lesson_id=? AND title=? ORDER BY id LIMIT 1").bind(lessonId, assignmentTitle).first<Record<string, any>>() : null,
      feedbackContent ? env.DB.prepare("SELECT id,status,updated_at AS updatedAt FROM feedback WHERE lesson_id=? AND COALESCE(student_id,0)=COALESCE(?,0) ORDER BY id DESC LIMIT 1").bind(lessonId, feedbackStudentId).first<Record<string, any>>() : null,
      env.DB.prepare("SELECT id,status,expected_amount AS expectedAmount,note,updated_at AS updatedAt FROM lesson_finance WHERE lesson_id=?").bind(lessonId).first<Record<string, any>>(),
    ]);
    const artifactSnapshot = { assignment: savedAssignment ? { id: savedAssignment.id, created: !beforeAssignment, before: beforeAssignment || null, afterUpdatedAt: savedAssignment.updatedAt } : null, feedback: savedFeedback ? { id: savedFeedback.id, created: !beforeFeedback, before: beforeFeedback || null, afterUpdatedAt: savedFeedback.updatedAt } : null, finance: savedFinance ? { id: savedFinance.id, created: !beforeFinance, before: beforeFinance || null, afterUpdatedAt: savedFinance.updatedAt } : null };
    await env.DB.prepare("UPDATE lesson_completion_runs SET artifact_snapshot=? WHERE id=?").bind(JSON.stringify(artifactSnapshot), runId).run();
    await audit(access, "complete", "lesson", lessonId, { students: records.length, assignment: Boolean(assignmentTitle), feedback: Boolean(feedbackContent), financeLocked, todos });
    return Response.json({ ok: true, status: "completed", completionRunId: runId, artifacts: { assignmentId: savedAssignment?.id || null, feedbackId: savedFeedback?.id || null, financeId: savedFinance?.id || null, financeStatus: savedFinance?.status || null, financeLocked }, todos });
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
