import { env } from "cloudflare:workers";
import { audit, can, isDenied, requirePermission } from "../../../lib/access";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const fallbackMime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const uploadPolicies = {
  "answer-card": { ownerType: "recognition", permission: "analytics:write", requireOwner: false },
  "feedback-import": { ownerType: "feedback_import", permission: "lessons:write", requireOwner: false },
  recognition_crop: { ownerType: "recognition_item", permission: "analytics:write", requireOwner: true },
} as const;

export async function POST(request: Request) {
  const access = await requirePermission("students:read");
  if (isDenied(access)) return access;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 27 * 1024 * 1024) return Response.json({ error: "上传正文超过 25MB 文件限制" }, { status: 413 });
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM file_assets WHERE created_by=? AND created_at>=datetime('now','-60 seconds')").bind(access.id).first<{ count: number }>();
  if (Number(recent?.count || 0) >= 20) return Response.json({ error: "短时间上传过多，系统已阻止可能的重复循环，请稍后再试" }, { status: 429 });

  const form = await request.formData(), purpose = String(form.get("purpose") || "") as keyof typeof uploadPolicies, policy = uploadPolicies[purpose];
  if (!policy) return Response.json({ error: "不支持的上传用途" }, { status: 400 });
  if (!can(access, policy.permission)) return Response.json({ error: "当前角色没有执行此操作的权限" }, { status: 403 });

  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择非空图片" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "图片不能超过 25MB" }, { status: 413 });
  const extension = file.name.toLowerCase().split(".").pop() || "", mime = imageTypes.has(file.type) ? file.type : fallbackMime[extension] || "";
  if (!imageTypes.has(mime)) return Response.json({ error: "仅支持 JPG、PNG 或 WebP 图片" }, { status: 415 });

  const ownerId = policy.requireOwner ? Number(form.get("ownerId") || 0) : null;
  if (policy.requireOwner && (!Number.isInteger(ownerId) || Number(ownerId) < 1)) return Response.json({ error: "缺少有效的题目记录" }, { status: 400 });
  if (purpose === "recognition_crop") {
    const item = await env.DB.prepare("SELECT ri.id FROM recognition_items ri JOIN recognition_jobs rj ON rj.id=ri.job_id JOIN file_assets source ON source.id=rj.source_asset_id WHERE ri.id=? AND source.created_by=?").bind(ownerId, access.id).first();
    if (!item) return Response.json({ error: "题目记录不存在或无权补充裁切图" }, { status: 403 });
  }

  const data = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const safeName = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, "_").slice(0, 120) || `upload.${extension || "jpg"}`;
  const key = `private/${purpose}/${access.id}/${Date.now()}-${digest.slice(0, 16)}-${safeName}`;
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  try {
    const row = await env.DB.prepare("INSERT INTO file_assets(owner_type,owner_id,storage_key,original_name,mime_type,size,fingerprint,purpose,status,created_by) VALUES(?,?,?,?,?,?,?,?,'active',?) RETURNING id").bind(policy.ownerType, ownerId, key, safeName, mime, file.size, digest, purpose, access.id).first<{ id: number }>();
    if (!row?.id) throw new Error("文件记录保存失败");
    await audit(access, "upload", "file_asset", row.id, { purpose, ownerType: policy.ownerType, ownerId, size: file.size, mimeType: mime });
    return Response.json({ id: row.id, name: safeName, size: file.size, url: `/api/v2/files/${row.id}` }, { status: 201 });
  } catch (reason) {
    await env.FILES.delete(key);
    return Response.json({ error: reason instanceof Error ? reason.message : "文件保存失败" }, { status: 500 });
  }
}
