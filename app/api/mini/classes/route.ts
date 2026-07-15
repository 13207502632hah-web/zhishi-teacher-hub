import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../lib/mini-auth";

export async function GET(request: Request) {
  const access = await requireMini(request, ["teacher"]); if (miniDenied(access)) return access;
  if (!access.userId) return Response.json({ error: "教师账号尚未关联网站用户" }, { status: 403 });
  const rows = await env.DB.prepare("SELECT c.id,c.name,c.grade,c.stage,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id AND e.status='active') AS studentCount FROM classes c WHERE c.status='active' AND (c.owner_id IS NULL OR c.owner_id=?) ORDER BY c.grade,c.name").bind(access.userId).all();
  return Response.json({ classes: rows.results });
}
