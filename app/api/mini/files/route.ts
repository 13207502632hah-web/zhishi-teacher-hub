import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../lib/mini-auth";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "audio/mp4", "video/mp4"]);

export async function POST(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const form = await request.formData(), file = form.get("file"), operationId = String(form.get("operationId") || "");
  if (!(file instanceof File)) return Response.json({ error: "请选择文件" }, { status: 400 });
  const extension = file.name.toLowerCase().split(".").pop() || "", safeExtension = ["jpg", "jpeg", "png", "webp", "pdf", "docx", "mp3", "m4a", "mp4"].includes(extension);
  if (!allowed.has(file.type) && !(file.type === "application/octet-stream" && safeExtension)) return Response.json({ error: "仅支持图片、短视频、语音、PDF和Word" }, { status: 415 });
  if (!file.size || file.size > 25 * 1024 * 1024) return Response.json({ error: "单个文件应小于25MB且不能为空" }, { status: 413 });
  const data = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const cleanName = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, "_").slice(0, 120), key = `private/mini/${access.accountId}/${Date.now()}-${digest.slice(0, 16)}-${cleanName}`;
  const mime = file.type === "application/octet-stream" ? mimeFor(extension) : file.type;
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  const row = await env.DB.prepare("INSERT INTO file_assets(owner_type,owner_id,storage_key,original_name,mime_type,size,fingerprint,purpose,status) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id")
    .bind("mini_account", access.accountId, key, cleanName, mime, file.size, digest, String(form.get("purpose") || "submission"), "active").first<{ id: number }>();
  if (!row) return Response.json({ error: "文件记录保存失败" }, { status: 500 });
  await env.DB.prepare("INSERT INTO file_leases(asset_id,operation_id,state,expires_at) VALUES(?,?, 'temporary',datetime('now','+7 day'))").bind(row.id, operationId || null).run();
  return Response.json({ id: row.id, name: cleanName, state: "temporary" }, { status: 201 });
}

const mimeFor = (extension: string) => ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4" }[extension] || "application/octet-stream");
