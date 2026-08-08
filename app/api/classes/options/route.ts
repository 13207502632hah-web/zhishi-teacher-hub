import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

const value = (input: unknown) => String(input || "").trim();

export async function GET(request: Request) {
  const access = await requirePermission("classes:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams;
  const selected = params.get("status") || "active", statuses = selected === "all" ? [] : [selected === "archived" ? "archived" : "active"];
  const q = value(params.get("q"));
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") || "50", 10) || 50));
  const ids = (params.get("ids") || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0)
    .filter((id, index, list) => list.indexOf(id) === index)
    .slice(0, 200);
  const where: string[] = [], bind: unknown[] = [];
  if (access.role === "teacher") { where.push("(c.owner_id IS NULL OR c.owner_id=?)"); bind.push(access.id); }
  if (access.role === "assistant") { where.push("EXISTS (SELECT 1 FROM staff_class_access sca WHERE sca.class_id=c.id AND sca.user_id=?)"); bind.push(access.id); }
  if (statuses.length) { where.push("c.status=?"); bind.push(statuses[0]); }
  if (q && ids.length) {
    where.push(`((c.name LIKE ? OR c.stage LIKE ? OR c.grade LIKE ?) OR c.id IN (${ids.map(() => "?").join(",")}))`);
    const like = `%${q}%`;
    bind.push(like, like, like, ...ids);
  } else if (q) {
    where.push("(c.name LIKE ? OR c.stage LIKE ? OR c.grade LIKE ?)");
    const like = `%${q}%`;
    bind.push(like, like, like);
  } else if (ids.length) {
    where.push(`c.id IN (${ids.map(() => "?").join(",")})`);
    bind.push(...ids);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM classes c ${whereSql}`).bind(...bind).first<{ total: number }>();
  const rows = await env.DB.prepare(`SELECT c.id,c.name,c.stage,c.grade FROM classes c ${whereSql} ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END,c.updated_at DESC LIMIT ?`).bind(...bind, limit).all();
  return Response.json({ classes: rows.results, total: Number(countRow?.total || 0) });
}
