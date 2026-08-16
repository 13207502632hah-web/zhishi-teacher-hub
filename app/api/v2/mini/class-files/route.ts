import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { accessibleStudentIds } from "../../../../lib/services/mini-sync-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const allowed = await accessibleStudentIds(access), requested = Number(new URL(request.url).searchParams.get("studentId") || 0), studentId = requested || allowed[0] || 0;
  if (!studentId || !allowed.includes(studentId)) return Response.json({ error: "尚未绑定学生或无权查看该学生" }, { status: 403 });
  const rows = await env.DB.prepare("SELECT cf.id,cf.asset_id AS assetId,cf.title,cf.description,cf.category,cf.published_at AS publishedAt,c.name AS className,fa.original_name AS fileName,fa.mime_type AS mimeType,fa.size FROM class_files cf JOIN classes c ON c.id=cf.class_id JOIN file_assets fa ON fa.id=cf.asset_id JOIN enrollments e ON e.class_id=cf.class_id AND e.student_id=? AND e.status='active' WHERE cf.status='published' AND fa.status='active' ORDER BY cf.published_at DESC,cf.id DESC LIMIT 300").bind(studentId).all<Record<string, unknown>>();
  return Response.json({ studentId, files: rows.results.map((row) => ({ ...row, url: `/api/v2/mini/files/${row.assetId}` })) }, { headers: { "Cache-Control": "private, no-store" } });
}
