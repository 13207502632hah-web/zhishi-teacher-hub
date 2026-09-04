import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "audio/mp4", "video/mp4"]);

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 27 * 1024 * 1024) return Response.json({ error: "上传正文超过 25MB 文件限制" }, { status: 413 });
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM file_assets WHERE created_by=? AND created_at>=datetime('now','-60 seconds')").bind(access.id).first<{ count: number }>();
  if (Number(recent?.count || 0) >= 20) return Response.json({ error: "短时间上传过多，系统已阻止可能的重复循环，请稍后再试" }, { status: 429 });
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择非空文件" }, { status: 400 });
  const extension = file.name.toLowerCase().split(".").pop() || "", fallback = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4" } as Record<string, string>)[extension];
  const mime = allowed.has(file.type) ? file.type : file.type === "application/octet-stream" || !file.type ? fallback : "";
  if (!mime || file.size > 25 * 1024 * 1024) return Response.json({ error: "仅支持25MB以内的图片、音视频、PDF和Word" }, { status: file.size > 25 * 1024 * 1024 ? 413 : 415 });
  const data = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const reusable = await env.DB.prepare("SELECT fa.id,fa.original_name AS name FROM file_assets fa JOIN file_leases fl ON fl.asset_id=fa.id WHERE fa.created_by=? AND fa.purpose='assignment' AND fa.fingerprint=? AND fa.size=? AND fa.status='active' AND fl.state='temporary' AND datetime(fl.expires_at)>datetime('now') ORDER BY fa.id DESC LIMIT 1").bind(access.id, digest, file.size).first<{ id: number; name: string }>();
  if (reusable) return Response.json({ id: reusable.id, name: reusable.name, reused: true });
  const name = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, "_").slice(0, 120), key = `private/assignments/${access.id}/${Date.now()}-${digest.slice(0, 16)}-${name}`;
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  const row = await env.DB.prepare("INSERT INTO file_assets(owner_type,owner_id,storage_key,original_name,mime_type,size,fingerprint,purpose,status,created_by) VALUES('user',?,?,?,?,?,?, 'assignment','active',?) RETURNING id")
    .bind(access.id, key, name, mime, file.size, digest, access.id).first<{ id: number }>();
  if (!row) return Response.json({ error: "附件保存失败" }, { status: 500 });
  await env.DB.prepare("INSERT INTO file_leases(asset_id,state,expires_at) VALUES(?, 'temporary',datetime('now','+7 day'))").bind(row.id).run();
  return Response.json({ id: row.id, name }, { status: 201 });
}
