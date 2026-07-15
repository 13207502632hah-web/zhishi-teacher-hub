import { env } from "cloudflare:workers";
import { isDenied, requirePermission, requireStudentAccess } from "../../../../lib/access";
import { standardDeviation } from "../../../../lib/academic-workflow";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const rows = (await env.DB.prepare("SELECT ep.id AS projectId,ep.name,ep.category,ep.academic_year AS academicYear,ep.exam_date AS examDate,ep.total_score AS totalScore,ar.score FROM exam_project_students eps JOIN exam_projects ep ON ep.id=eps.project_id JOIN assessment_results ar ON ar.id=eps.assessment_result_id WHERE eps.student_id=? AND ar.score IS NOT NULL ORDER BY COALESCE(ep.exam_date,ep.created_at),ep.id").bind(id).all<Record<string, unknown>>()).results;
  const series = rows.map((row, index) => { const rate = Number(row.score) / Number(row.totalScore) * 100, prior = index ? Number(rows[index - 1].score) / Number(rows[index - 1].totalScore) * 100 : null, window = rows.slice(Math.max(0, index - 2), index + 1).map((item) => Number(item.score) / Number(item.totalScore) * 100); return { ...row, rate, change: prior == null ? null : rate - prior, movingAverage3: window.length < 3 ? null : window.reduce((sum, value) => sum + value, 0) / 3 }; });
  return Response.json({ series, trend: series.length < 2 ? "数据不足" : "ready", stability: series.length < 3 ? null : standardDeviation(series.map((item) => item.rate)) });
}
