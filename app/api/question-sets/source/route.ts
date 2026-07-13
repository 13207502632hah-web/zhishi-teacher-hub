import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择 Word 文件" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".docx") || file.type && !/wordprocessingml|octet-stream/.test(file.type)) return Response.json({ error: "仅支持未加密的 .docx 文件" }, { status: 415 });
  if (!file.size || file.size > 15 * 1024 * 1024) return Response.json({ error: "文件必须大于 0 且不超过 15MB" }, { status: 413 });
  const buffer = await file.arrayBuffer(), signature = new Uint8Array(buffer.slice(0, 4));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) return Response.json({ error: "文件内容不是有效的 DOCX 压缩包" }, { status: 415 });
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""), key = `question-sources/${new Date().toISOString().slice(0, 10)}/${digest}.docx`;
  await env.FILES.put(key, buffer, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, customMetadata: { originalName: file.name, uploadedBy: String(access.id) } });
  await audit(access, "upload_source", "question_set", digest.slice(0, 16), { key, originalName: file.name, size: file.size });
  return Response.json({ key, fingerprint: digest, originalName: file.name, size: file.size });
}
