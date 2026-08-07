import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

const columns = ["stage", "grade", "textbook_version", "volume", "unit", "topic", "knowledge_points", "question_type", "difficulty", "region", "exam_type", "year"] as const;

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, status = params.get("status") === "review" ? "review" : "active";
  const hierarchy = [
    ["stage", params.get("stage")],
    ["grade", params.get("grade")],
    ["textbook_version", params.get("textbookVersion")],
    ["volume", params.get("volume")],
    ["unit", params.get("unit")],
    ["topic", params.get("topic")],
    ["question_type", params.get("type")],
    ["difficulty", params.get("difficulty")],
    ["region", params.get("region")],
    ["exam_type", params.get("examType")],
    ["year", params.get("year")],
  ] as const;
  const facets: Record<string, Array<{ value: string | number; count: number }>> = {};
  await Promise.all(columns.map(async (column) => {
    const parents = hierarchy.filter(([field, value]) => value && field !== column), where = ["status=?", ...parents.map(([field]) => `${field}=?`), `${column} IS NOT NULL`, `TRIM(CAST(${column} AS TEXT))!=''`];
    const result = await env.DB.prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM questions WHERE ${where.join(" AND ")} GROUP BY ${column} ORDER BY count DESC, ${column} LIMIT 300`).bind(status, ...parents.map(([, value]) => value)).all<{ value: string | number; count: number }>();
    facets[column] = result.results;
  }));
  return Response.json({ facets });
}
