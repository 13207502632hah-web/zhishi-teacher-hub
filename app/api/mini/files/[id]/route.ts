import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { accessibleStudentIds } from "../../../../lib/services/mini-sync-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const id = Number((await context.params).id), meta = await env.DB.prepare("SELECT storage_key AS storageKey,original_name AS originalName,mime_type AS mimeType,owner_type AS ownerType,owner_id AS ownerId,status FROM file_assets WHERE id=?").bind(id).first<Record<string, any>>();
  if (!meta || meta.status !== "active") return Response.json({ error: "文件不存在" }, { status: 404 });
  let allowed = access.role === "teacher" || (meta.ownerType === "mini_account" && Number(meta.ownerId) === access.accountId);
  const studentIds = allowed ? [] : await accessibleStudentIds(access);
  if (!allowed && studentIds.length) {
    const marks = studentIds.map(() => "?").join(",");
    allowed = Boolean(await env.DB.prepare(`SELECT 1 FROM assignment_assets aa JOIN assignments a ON a.id=aa.assignment_id WHERE aa.asset_id=? AND a.status='published' AND (EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id AND t.target_type='student' AND t.target_id IN (${marks})) OR (NOT EXISTS(SELECT 1 FROM assignment_targets st WHERE st.assignment_id=a.id AND st.target_type='student') AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id=a.class_id AND e.student_id IN (${marks}) AND e.status='active'))) UNION SELECT 1 FROM submission_assets sa JOIN submission_versions sv ON sv.id=sa.submission_version_id JOIN assignment_submissions s ON s.id=sv.submission_id WHERE sa.asset_id=? AND s.student_id IN (${marks}) LIMIT 1`).bind(id, ...studentIds, ...studentIds, id, ...studentIds).first());
  }
  if (!allowed) allowed = Boolean(await env.DB.prepare("SELECT 1 FROM excellent_submissions WHERE masked_asset_id=? AND masking_status='confirmed' AND published_at IS NOT NULL").bind(id).first());
  if (!allowed) return Response.json({ error: "无权查看此文件" }, { status: 403 });
  const object = await env.FILES.get(meta.storageKey); if (!object) return Response.json({ error: "文件内容不存在" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": meta.mimeType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
