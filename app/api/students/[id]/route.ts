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
  const [lessonRecords, submissions, feedbackRows, results, wrongQuestions, knowledgeEvidence, questionResults] = await Promise.all([
    env.DB.prepare("SELECT r.*,l.date,l.course_name AS courseName,l.topic FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.student_id=? ORDER BY l.date DESC").bind(id).all(),
    env.DB.prepare("SELECT s.*,a.title,a.due_at AS dueAt,l.date AS lessonDate FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE s.student_id=? ORDER BY a.created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT f.*,l.date AS lessonDate,l.topic FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.student_id=? ORDER BY f.created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT r.*,r.objective_score AS objectiveScore,r.subjective_score AS subjectiveScore,r.weak_knowledge AS weakKnowledge,r.teacher_note AS teacherNote,a.title,a.date,a.total_score AS totalScore,a.type FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE r.student_id=? ORDER BY a.date DESC").bind(id).all(),
    env.DB.prepare("SELECT w.id,w.question_id AS questionId,w.lesson_id AS lessonId,w.incorrect_answer AS incorrectAnswer,w.reason,w.status,w.occurred_at AS occurredAt,w.mastered_at AS masteredAt,q.stem,q.answer,q.knowledge_points AS knowledgePoints,l.date AS lessonDate,l.topic AS lessonTopic FROM wrong_questions w JOIN questions q ON q.id=w.question_id LEFT JOIN lessons l ON l.id=w.lesson_id WHERE w.student_id=? ORDER BY CASE w.status WHEN 'active' THEN 0 ELSE 1 END,w.occurred_at DESC").bind(id).all(),
    env.DB.prepare("SELECT ke.knowledge_name AS knowledgeName,ke.level,ke.source_type AS sourceType,ke.evidence,ke.is_manual AS isManual,ke.created_at AS createdAt,tn.path FROM knowledge_evidence ke LEFT JOIN textbook_nodes tn ON tn.id=ke.textbook_node_id WHERE ke.student_id=? ORDER BY ke.created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT aqr.question_number AS questionNumber,aqr.score,aqr.max_score AS maxScore,aqr.knowledge_points AS knowledgePoints,aqr.error_type AS errorType,a.title,a.date FROM assessment_question_results aqr JOIN assessment_results ar ON ar.id=aqr.assessment_result_id JOIN assessments a ON a.id=ar.assessment_id WHERE ar.student_id=? ORDER BY a.date DESC,aqr.id").bind(id).all(),
  ]);
  const submissionRows = submissions.results as Array<Record<string, unknown>>, resultRows = results.results as Array<Record<string, unknown>>, wrongRows = wrongQuestions.results as Array<Record<string, unknown>>, attention: Array<{ level: string; title: string; evidence: string }> = [];
  const pending = submissionRows.filter((item) => !["completed", "corrected"].includes(String(item.status))).length; if (pending) attention.push({ level: pending >= 2 ? "high" : "normal", title: `${pending}项作业待完成或订正`, evidence: "依据当前作业提交状态，完成后提醒会自动消失" });
  const activeWrong = wrongRows.filter((item) => item.status === "active"); if (activeWrong.length) attention.push({ level: activeWrong.length >= 3 ? "high" : "normal", title: `${activeWrong.length}道错题仍待巩固`, evidence: [...new Set(activeWrong.map((item) => String(item.knowledgePoints || "")).filter(Boolean))].slice(0, 3).join("、") || "依据错题掌握状态" });
  if (resultRows.length >= 2) { const current = Number(resultRows[0].score || 0) / Math.max(1, Number(resultRows[0].totalScore || 100)), previous = Number(resultRows[1].score || 0) / Math.max(1, Number(resultRows[1].totalScore || 100)); if (current + .08 < previous) attention.push({ level: "high", title: "最近一次测验得分率下降", evidence: `最近两次得分率约为${Math.round(previous * 100)}%→${Math.round(current * 100)}%，仅作提醒，不代表长期趋势` }); }
  if (!lessonRecords.results.length) attention.push({ level: "normal", title: "暂无课时表现记录", evidence: "完成一次课时记录后可开始形成学习趋势" });
  return Response.json({ student, attention, lessonRecords: lessonRecords.results, submissions: submissionRows, feedback: feedbackRows.results, results: resultRows, wrongQuestions: wrongRows, knowledgeEvidence: knowledgeEvidence.results, questionResults: questionResults.results });
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
