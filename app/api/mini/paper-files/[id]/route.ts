import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { accessibleStudentIds } from "../../../../lib/services/mini-sync-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const id = Number((await context.params).id), meta = await env.DB.prepare("SELECT pf.storage_key AS storageKey,pf.original_name AS originalName,pf.mime_type AS mimeType,pf.paper_id AS paperId FROM paper_files pf WHERE pf.id=?").bind(id).first<Record<string, any>>();
  if (!meta) return Response.json({ error: "试卷文件不存在" }, { status: 404 });
  let allowed = access.role === "teacher";
  if (!allowed) {
    const ids = await accessibleStudentIds(access);
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      allowed = Boolean(await env.DB.prepare(`SELECT 1 FROM assignments a WHERE a.paper_id=? AND a.status='published' AND (EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id AND t.target_type='student' AND t.target_id IN (${marks})) OR (NOT EXISTS(SELECT 1 FROM assignment_targets st WHERE st.assignment_id=a.id AND st.target_type='student') AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id=a.class_id AND e.student_id IN (${marks}) AND e.status='active'))) LIMIT 1`).bind(meta.paperId, ...ids, ...ids).first());
    }
  }
  if (!allowed) return Response.json({ error: "无权查看此试卷" }, { status: 403 });
  const object = await env.FILES.get(meta.storageKey); if (!object) return Response.json({ error: "试卷文件内容不存在" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": meta.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
