import { env } from "cloudflare:workers";
import { assessmentStats, validateAssessmentResult } from "../../../lib/assessment";
import { audit, isDenied, requireAssessmentAccess, requirePermission } from "../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireAssessmentAccess(access, id); if (denied) return denied;
  const assessment = await env.DB.prepare("SELECT a.*,a.class_id AS classId,a.paper_id AS paperId,a.total_score AS totalScore,c.name AS className,p.title AS paperTitle FROM assessments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN papers p ON p.id=a.paper_id WHERE a.id=?").bind(id).first<Record<string, unknown>>();
  if (!assessment) return Response.json({ error: "测验不存在" }, { status: 404 });
  const rows = await env.DB.prepare("SELECT s.id AS studentId,s.name,s.grade,r.id AS resultId,r.score,r.objective_score AS objectiveScore,r.subjective_score AS subjectiveScore,r.knowledge_mastery AS knowledgeMastery,r.weak_knowledge AS weakKnowledge,r.teacher_note AS teacherNote FROM enrollments e JOIN students s ON s.id=e.student_id AND s.status='active' LEFT JOIN assessment_results r ON r.assessment_id=? AND r.student_id=s.id WHERE e.class_id=? AND e.status='active' ORDER BY s.name").bind(id, Number(assessment.classId)).all<Record<string, unknown>>();
  return Response.json({ assessment, results: rows.results, stats: assessmentStats(rows.results.map((row) => ({ score: row.score == null ? null : Number(row.score), weakKnowledge: String(row.weakKnowledge || "") })), Number(assessment.totalScore)) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireAssessmentAccess(access, id); if (denied) return denied;
  const assessment = await env.DB.prepare("SELECT class_id AS classId,total_score AS totalScore FROM assessments WHERE id=?").bind(id).first<{ classId: number; totalScore: number }>();
  if (!assessment) return Response.json({ error: "测验不存在" }, { status: 404 });
  const body = await request.json() as { results?: Array<Record<string, unknown>>; status?: string }, rows = (body.results || []).slice(0, 200), members = await env.DB.prepare("SELECT student_id AS id FROM enrollments WHERE class_id=? AND status='active'").bind(assessment.classId).all<{ id: number }>(), allowed = new Set(members.results.map((item) => Number(item.id)));
  const statements = [];
  for (const row of rows) {
    const studentId = Number(row.studentId), score = row.score === "" || row.score == null ? null : Number(row.score), objectiveScore = row.objectiveScore === "" || row.objectiveScore == null ? null : Number(row.objectiveScore), subjectiveScore = row.subjectiveScore === "" || row.subjectiveScore == null ? null : Number(row.subjectiveScore);
    if (!allowed.has(studentId)) return Response.json({ error: "成绩列表包含不属于当前班级的学生" }, { status: 400 });
    const error = validateAssessmentResult({ score, objectiveScore, subjectiveScore }, Number(assessment.totalScore)); if (error) return Response.json({ error, studentId }, { status: 400 });
    statements.push(env.DB.prepare("INSERT INTO assessment_results(assessment_id,student_id,score,objective_score,subjective_score,knowledge_mastery,weak_knowledge,teacher_note) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,objective_score=excluded.objective_score,subjective_score=excluded.subjective_score,knowledge_mastery=excluded.knowledge_mastery,weak_knowledge=excluded.weak_knowledge,teacher_note=excluded.teacher_note,updated_at=CURRENT_TIMESTAMP").bind(id, studentId, score, objectiveScore, subjectiveScore, String(row.knowledgeMastery || ""), String(row.weakKnowledge || ""), String(row.teacherNote || "")));
  }
  if (statements.length) await env.DB.batch(statements);
  const status = body.status === "completed" ? "completed" : "draft"; await env.DB.prepare("UPDATE assessments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, id).run();
  await audit(access, "batch_update", "assessment_results", id, { count: rows.length, status });
  return Response.json({ ok: true, count: rows.length, status });
}
