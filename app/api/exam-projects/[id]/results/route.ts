import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), project = await env.DB.prepare("SELECT * FROM exam_projects WHERE id=?").bind(id).first();
  if (!project) return Response.json({ error: "考试项目不存在" }, { status: 404 });
  const students = await env.DB.prepare("SELECT eps.id AS memberId,eps.status,eps.assessment_result_id AS resultId,s.id AS studentId,s.name,s.grade,s.school,ar.score,ar.objective_score AS objectiveScore,ar.subjective_score AS subjectiveScore,ar.teacher_note AS teacherNote FROM exam_project_students eps JOIN students s ON s.id=eps.student_id LEFT JOIN assessment_results ar ON ar.id=eps.assessment_result_id WHERE eps.project_id=? ORDER BY s.name").bind(id).all();
  return Response.json({ project, students: students.results });
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), body = await request.json() as { results?: Array<Record<string, unknown>> }, project = await env.DB.prepare("SELECT * FROM exam_projects WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!project) return Response.json({ error: "考试项目不存在" }, { status: 404 });
  let assessment = await env.DB.prepare("SELECT id FROM assessments WHERE exam_project_id=? ORDER BY id LIMIT 1").bind(id).first<{ id: number }>();
  if (!assessment) assessment = await env.DB.prepare("INSERT INTO assessments(exam_project_id,paper_id,title,date,total_score,type,status) VALUES(?,?,?,?,?,?, 'draft') RETURNING id").bind(id, project.paper_id || null, project.name, project.exam_date || null, project.total_score, project.category).first<{ id: number }>();
  const valid = (body.results || []).filter((item) => Number(item.studentId) > 0);
  for (const item of valid) {
    const studentId = Number(item.studentId), raw = item.score, score = raw === "" || raw == null ? null : Number(raw);
    if (score != null && (!Number.isFinite(score) || score < 0 || score > Number(project.total_score))) return Response.json({ error: `${studentId}号学生分数超出0至${project.total_score}` }, { status: 400 });
    if (score == null) { await env.DB.prepare("UPDATE exam_project_students SET status='pending',updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND student_id=?").bind(id, studentId).run(); continue; }
    const result = await env.DB.prepare("INSERT INTO assessment_results(assessment_id,student_id,score,objective_score,subjective_score,teacher_note) VALUES(?,?,?,?,?,?) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,objective_score=excluded.objective_score,subjective_score=excluded.subjective_score,teacher_note=excluded.teacher_note,updated_at=CURRENT_TIMESTAMP RETURNING id").bind(assessment?.id, studentId, score, item.objectiveScore === "" ? null : Number(item.objectiveScore), item.subjectiveScore === "" ? null : Number(item.subjectiveScore), String(item.teacherNote || "")).first<{ id: number }>();
    await env.DB.prepare("UPDATE exam_project_students SET assessment_result_id=?,status='recorded',updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND student_id=?").bind(result?.id, id, studentId).run();
    for (const question of (item.questions as Array<Record<string, unknown>> || [])) if (String(question.questionNumber || "").trim()) await env.DB.prepare("INSERT INTO assessment_question_results(assessment_result_id,question_id,question_number,answer,score,max_score,knowledge_points,error_type,source,confirmed_at) VALUES(?,?,?,?,?,?,?,?, 'manual',CURRENT_TIMESTAMP) ON CONFLICT(assessment_result_id,question_number) DO UPDATE SET answer=excluded.answer,score=excluded.score,max_score=excluded.max_score,knowledge_points=excluded.knowledge_points,error_type=excluded.error_type,confirmed_at=CURRENT_TIMESTAMP").bind(result?.id, Number(question.questionId || 0) || null, String(question.questionNumber), String(question.answer || ""), question.score == null ? null : Number(question.score), question.maxScore == null ? null : Number(question.maxScore), String(question.knowledgePoints || ""), String(question.errorType || "")).run();
  }
  await audit(access, "update_results", "exam_project", id, { count: valid.length });
  return Response.json({ ok: true, updated: valid.length });
}
