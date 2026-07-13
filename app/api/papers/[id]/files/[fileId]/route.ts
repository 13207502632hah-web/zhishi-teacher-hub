import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../../lib/access";

export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const { id, fileId } = await context.params, row = await env.DB.prepare("SELECT storage_key AS storageKey,original_name AS originalName,mime_type AS mimeType FROM paper_files WHERE id=? AND paper_id=?").bind(Number(fileId), Number(id)).first<{ storageKey: string; originalName: string; mimeType: string }>();
  if (!row) return Response.json({ error: "试卷文件不存在" }, { status: 404 });
  const object = await env.FILES.get(row.storageKey); if (!object) return Response.json({ error: "原始文件已不可用" }, { status: 404 });
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new Response(object.body, { headers: { "Content-Type": row.mimeType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.originalName)}`, "Cache-Control": "private, no-store" } });
}
