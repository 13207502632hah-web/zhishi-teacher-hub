import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission, requireStudentAccess } from "../../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const number = (value: unknown) => Number(value || 0);
const text = (value: unknown) => String(value || "").trim();

async function ensureLessonMember(studentId: number, lessonId: number) {
  return Boolean(await env.DB.prepare("SELECT 1 AS allowed FROM enrollments e JOIN lessons l ON l.class_id=e.class_id WHERE e.student_id=? AND e.status='active' AND l.id=? LIMIT 1").bind(studentId, lessonId).first());
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const studentId = await idFrom(context), denied = await requireStudentAccess(access, studentId); if (denied) return denied;
  const rows = await env.DB.prepare("SELECT w.id,w.student_id AS studentId,w.question_id AS questionId,w.lesson_id AS lessonId,w.incorrect_answer AS incorrectAnswer,w.reason,w.status,w.occurred_at AS occurredAt,w.mastered_at AS masteredAt,w.created_at AS createdAt,w.updated_at AS updatedAt,q.stem,q.answer,q.analysis,q.question_type AS questionType,q.knowledge_points AS knowledgePoints,l.date AS lessonDate,l.topic AS lessonTopic FROM wrong_questions w JOIN questions q ON q.id=w.question_id LEFT JOIN lessons l ON l.id=w.lesson_id WHERE w.student_id=? ORDER BY CASE w.status WHEN 'active' THEN 0 ELSE 1 END,w.occurred_at DESC,w.id DESC").bind(studentId).all();
  return Response.json({ wrongQuestions: rows.results });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const studentId = await idFrom(context), denied = await requireStudentAccess(access, studentId); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>, questionId = number(body.questionId), rawLessonId = number(body.lessonId), lessonId = rawLessonId > 0 ? rawLessonId : null;
  if (!Number.isFinite(questionId) || questionId <= 0) return Response.json({ error: "请选择正式题库中的题目" }, { status: 400 });
  const question = await env.DB.prepare("SELECT id FROM questions WHERE id=? AND status='active'").bind(questionId).first();
  if (!question) return Response.json({ error: "题目不存在或尚未完成入库校对" }, { status: 400 });
  if (lessonId) {
    const lessonDenied = await requireLessonAccess(access, lessonId); if (lessonDenied) return lessonDenied;
    if (!await ensureLessonMember(studentId, lessonId)) return Response.json({ error: "该学生不属于所选课时对应的班级" }, { status: 400 });
  }
  const existing = await env.DB.prepare("SELECT id FROM wrong_questions WHERE student_id=? AND question_id=? AND ((lesson_id IS NULL AND ? IS NULL) OR lesson_id=?) LIMIT 1").bind(studentId, questionId, lessonId, lessonId).first<{ id: number }>();
  const incorrectAnswer = text(body.incorrectAnswer), reason = text(body.reason), occurredAt = text(body.occurredAt) || new Date().toISOString();
  if (existing) {
    await env.DB.prepare("UPDATE wrong_questions SET incorrect_answer=?,reason=?,status='active',occurred_at=?,mastered_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(incorrectAnswer, reason, occurredAt, existing.id).run();
    await audit(access, "reopen", "wrong_question", existing.id, { studentId, questionId, lessonId });
    return Response.json({ ok: true, wrongQuestionId: existing.id, updated: true });
  }
  const row = await env.DB.prepare("INSERT INTO wrong_questions(student_id,question_id,lesson_id,incorrect_answer,reason,status,occurred_at) VALUES(?,?,?,?,?,'active',?) RETURNING id").bind(studentId, questionId, lessonId, incorrectAnswer, reason, occurredAt).first<{ id: number }>();
  if (!row) return Response.json({ error: "错题登记失败，请稍后重试" }, { status: 500 });
  await audit(access, "create", "wrong_question", row.id, { studentId, questionId, lessonId });
  return Response.json({ ok: true, wrongQuestionId: row.id }, { status: 201 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const studentId = await idFrom(context), denied = await requireStudentAccess(access, studentId); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>, wrongQuestionId = number(body.wrongQuestionId), status = body.status === "mastered" ? "mastered" : "active";
  if (!wrongQuestionId) return Response.json({ error: "缺少错题记录" }, { status: 400 });
  const row = await env.DB.prepare("SELECT id FROM wrong_questions WHERE id=? AND student_id=?").bind(wrongQuestionId, studentId).first<{ id: number }>();
  if (!row) return Response.json({ error: "错题记录不存在" }, { status: 404 });
  await env.DB.prepare("UPDATE wrong_questions SET status=?,mastered_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, status === "mastered" ? new Date().toISOString() : null, wrongQuestionId).run();
  await audit(access, status === "mastered" ? "master" : "reopen", "wrong_question", wrongQuestionId, { studentId });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const studentId = await idFrom(context), denied = await requireStudentAccess(access, studentId); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>, wrongQuestionId = number(body.wrongQuestionId);
  if (!wrongQuestionId) return Response.json({ error: "缺少错题记录" }, { status: 400 });
  const result = await env.DB.prepare("DELETE FROM wrong_questions WHERE id=? AND student_id=?").bind(wrongQuestionId, studentId).run();
  if (!Number(result.meta?.changes || 0)) return Response.json({ error: "错题记录不存在" }, { status: 404 });
  await audit(access, "delete", "wrong_question", wrongQuestionId, { studentId });
  return Response.json({ ok: true });
}
