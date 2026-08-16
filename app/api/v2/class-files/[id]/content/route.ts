import { env } from "cloudflare:workers";
import { isDenied, requireClassAccess, requirePermission } from "../../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), row = await env.DB.prepare("SELECT cf.class_id AS classId,cf.status,fa.storage_key AS storageKey,fa.original_name AS originalName,fa.mime_type AS mimeType,fa.status AS assetStatus FROM class_files cf JOIN file_assets fa ON fa.id=cf.asset_id WHERE cf.id=?").bind(id).first<Record<string, unknown>>();
  if (!row || row.status === "archived" || row.assetStatus !== "active") return Response.json({ error: "班级文件不存在" }, { status: 404 });
  const denied = await requireClassAccess(access, Number(row.classId)); if (denied) return denied;
  const object = await env.FILES.get(String(row.storageKey)); if (!object) return Response.json({ error: "文件内容不存在" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": String(row.mimeType), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.originalName))}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
