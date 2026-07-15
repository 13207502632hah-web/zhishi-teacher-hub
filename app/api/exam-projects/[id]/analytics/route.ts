import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";
import { average, standardDeviation } from "../../../../lib/academic-workflow";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), project = await env.DB.prepare("SELECT * FROM exam_projects WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!project) return Response.json({ error: "考试项目不存在" }, { status: 404 });
  const rows = (await env.DB.prepare("SELECT ar.score FROM exam_project_students eps JOIN assessment_results ar ON ar.id=eps.assessment_result_id WHERE eps.project_id=? AND ar.score IS NOT NULL").bind(id).all<{ score: number }>()).results.map((item) => Number(item.score));
  const questions = await env.DB.prepare("SELECT aqr.question_number AS questionNumber,MAX(aqr.max_score) AS maxScore,ROUND(AVG(aqr.score),2) AS averageScore,ROUND(AVG(CASE WHEN aqr.max_score>0 THEN aqr.score/aqr.max_score END)*100,1) AS correctRate,aqr.knowledge_points AS knowledgePoints,aqr.error_type AS errorType,COUNT(*) AS count FROM assessment_question_results aqr JOIN assessment_results ar ON ar.id=aqr.assessment_result_id JOIN assessments a ON a.id=ar.assessment_id WHERE a.exam_project_id=? GROUP BY aqr.question_number,aqr.knowledge_points,aqr.error_type ORDER BY CAST(aqr.question_number AS INTEGER)").bind(id).all();
  return Response.json({ summary: { recorded: rows.length, averageScore: average(rows), averageRate: average(rows) == null ? null : Number(average(rows)) / Number(project.total_score) * 100, volatility: standardDeviation(rows) }, questions: questions.results, dataStatus: rows.length < 2 ? "数据不足" : "ready" });
}
