import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "audio/mp4", "video/mp4"]);

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择非空文件" }, { status: 400 });
  const extension = file.name.toLowerCase().split(".").pop() || "", fallback = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4" } as Record<string, string>)[extension];
  const mime = allowed.has(file.type) ? file.type : file.type === "application/octet-stream" || !file.type ? fallback : "";
  if (!mime || file.size > 25 * 1024 * 1024) return Response.json({ error: "仅支持25MB以内的图片、音视频、PDF和Word" }, { status: file.size > 25 * 1024 * 1024 ? 413 : 415 });
  const data = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const name = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, "_").slice(0, 120), key = `private/assignments/${access.id}/${Date.now()}-${digest.slice(0, 16)}-${name}`;
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  const row = await env.DB.prepare("INSERT INTO file_assets(owner_type,owner_id,storage_key,original_name,mime_type,size,fingerprint,purpose,status,created_by) VALUES('user',?,?,?,?,?,?, 'assignment','active',?) RETURNING id")
    .bind(access.id, key, name, mime, file.size, digest, access.id).first<{ id: number }>();
  if (!row) return Response.json({ error: "附件保存失败" }, { status: 500 });
  await env.DB.prepare("INSERT INTO file_leases(asset_id,state,expires_at) VALUES(?, 'temporary',datetime('now','+7 day'))").bind(row.id).run();
  return Response.json({ id: row.id, name }, { status: 201 });
}
