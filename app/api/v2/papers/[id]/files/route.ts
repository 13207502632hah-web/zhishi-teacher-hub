import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), paper = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(id).first();
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const files = await env.DB.prepare("SELECT id,version_type AS versionType,original_name AS originalName,mime_type AS mimeType,size,parse_status AS parseStatus,parse_message AS parseMessage,created_at AS createdAt FROM paper_files WHERE paper_id=? ORDER BY created_at DESC,id DESC").bind(id).all();
  return Response.json({ files: files.results });
}
