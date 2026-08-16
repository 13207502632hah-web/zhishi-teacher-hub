import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

export async function GET() {
  const access = await requirePermission("analytics:read");
  if (isDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT ay.id,ay.name,ay.start_date AS startDate,ay.end_date AS endDate,ay.status,COUNT(DISTINCT ep.id) AS projectCount,COUNT(DISTINCT gpr.id) AS promotionRunCount FROM academic_years ay LEFT JOIN exam_projects ep ON ep.academic_year=ay.name LEFT JOIN grade_promotion_runs gpr ON gpr.academic_year=ay.name GROUP BY ay.id ORDER BY ay.start_date DESC").all();
  return Response.json({ academicYears: rows.results });
}
