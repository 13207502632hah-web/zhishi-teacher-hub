import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

async function assistantCanRead(assetId: number, userId: number, createdBy: number | null, ownerType: string, ownerId: number | null) {
  if (createdBy === userId || (ownerType === "user" && ownerId === userId)) return true;
  const row = await env.DB.prepare(`
    SELECT 1 AS allowed FROM assignment_assets aa JOIN assignments a ON a.id=aa.assignment_id JOIN staff_class_access sca ON sca.class_id=a.class_id WHERE aa.asset_id=? AND sca.user_id=?
    UNION ALL
    SELECT 1 AS allowed FROM submission_assets sa JOIN submission_versions sv ON sv.id=sa.submission_version_id JOIN assignment_submissions s ON s.id=sv.submission_id JOIN assignments a ON a.id=s.assignment_id JOIN staff_class_access sca ON sca.class_id=a.class_id WHERE sa.asset_id=? AND sca.user_id=?
    UNION ALL
    SELECT 1 AS allowed FROM review_assets ra JOIN submission_reviews sr ON sr.id=ra.review_id JOIN assignment_submissions s ON s.id=sr.submission_id JOIN assignments a ON a.id=s.assignment_id JOIN staff_class_access sca ON sca.class_id=a.class_id WHERE ra.asset_id=? AND sca.user_id=?
    UNION ALL
    SELECT 1 AS allowed FROM class_files cf JOIN staff_class_access sca ON sca.class_id=cf.class_id WHERE cf.asset_id=? AND sca.user_id=?
    LIMIT 1
  `).bind(assetId, userId, assetId, userId, assetId, userId, assetId, userId).first();
  return Boolean(row);
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:read");
  if (isDenied(access)) return access;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "文件编号无效" }, { status: 400 });

  const meta = await env.DB.prepare("SELECT storage_key AS storageKey,original_name AS originalName,mime_type AS mimeType,owner_type AS ownerType,owner_id AS ownerId,created_by AS createdBy,status FROM file_assets WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!meta || meta.status !== "active") return Response.json({ error: "文件不存在" }, { status: 404 });
  if (access.role === "assistant" && !await assistantCanRead(id, access.id, meta.createdBy == null ? null : Number(meta.createdBy), String(meta.ownerType || ""), meta.ownerId == null ? null : Number(meta.ownerId))) {
    return Response.json({ error: "当前账号未获授权访问该文件" }, { status: 403 });
  }

  const object = await env.FILES.get(String(meta.storageKey));
  if (!object) return Response.json({ error: "文件内容不存在" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": String(meta.mimeType), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(meta.originalName))}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
