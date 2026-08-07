import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { canReadQuestionSourceObject } from "../../../lib/question-source-access";

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "缺少原始文件 key" }, { status: 400 });
  const object = await env.FILES.get(key);
  if (!object) return Response.json({ error: "原始 Word 文件不存在或已过期，请重新上传" }, { status: 404 });
  const allowed = await canReadQuestionSourceObject(access, env.DB, object, key);
  if (!allowed) return Response.json({ error: "当前账号未获授权访问该原始文件" }, { status: 403 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="source.docx"`, "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择 Word 文件" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".docx") || file.type && !/wordprocessingml|octet-stream/.test(file.type)) return Response.json({ error: "仅支持未加密的 .docx 文件" }, { status: 415 });
  if (!file.size || file.size > 15 * 1024 * 1024) return Response.json({ error: "文件必须大于 0 且不超过 15MB" }, { status: 413 });
  const buffer = await file.arrayBuffer(), signature = new Uint8Array(buffer.slice(0, 4));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) return Response.json({ error: "文件内容不是有效的 DOCX 压缩包" }, { status: 415 });
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""), key = `question-sources/${new Date().toISOString().slice(0, 10)}/${digest}.docx`;
  await env.FILES.put(key, buffer, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, customMetadata: { originalName: file.name, uploadedBy: String(access.id), fingerprint: digest } });
  await audit(access, "upload_source", "question_set", digest.slice(0, 16), { key, originalName: file.name, size: file.size });
  return Response.json({ key, fingerprint: digest, originalName: file.name, size: file.size });
}
