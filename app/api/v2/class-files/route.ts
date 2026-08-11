import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../lib/access";

const allowedMime = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "audio/mpeg", "audio/mp4",
]);
const fallbackMime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", mp3: "audio/mpeg", m4a: "audio/mp4" };
const clean = (value: unknown, max: number) => String(value || "").trim().slice(0, max);

export async function GET(request: Request) {
  const access = await requirePermission("resources:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, classId = Number(params.get("classId") || 0), status = params.get("status") || "active", q = clean(params.get("q"), 100);
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const where: string[] = [], bind: unknown[] = [];
  if (access.role === "assistant") { where.push("EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=cf.class_id AND sca.user_id=?)"); bind.push(access.id); }
  if (classId) { where.push("cf.class_id=?"); bind.push(classId); }
  if (status === "archived") where.push("cf.status='archived'"); else if (status !== "all") where.push("cf.status!='archived'");
  if (q) { where.push("(cf.title LIKE ? OR cf.description LIKE ? OR cf.category LIKE ? OR fa.original_name LIKE ?)"); const like = `%${q}%`; bind.push(like, like, like, like); }
  const rows = await env.DB.prepare(`SELECT cf.id,cf.class_id AS classId,cf.asset_id AS assetId,cf.title,cf.description,cf.category,cf.status,cf.published_at AS publishedAt,cf.created_at AS createdAt,cf.updated_at AS updatedAt,c.name AS className,fa.original_name AS fileName,fa.mime_type AS mimeType,fa.size FROM class_files cf JOIN classes c ON c.id=cf.class_id JOIN file_assets fa ON fa.id=cf.asset_id WHERE ${where.length ? where.join(" AND ") : "1=1"} ORDER BY cf.updated_at DESC,cf.id DESC LIMIT 300`).bind(...bind).all<Record<string, unknown>>();
  const files = rows.results.map((row) => ({ ...row, url: `/api/v2/class-files/${row.id}/content` }));
  return Response.json({ files, counts: { total: files.length, draft: rows.results.filter((item) => item.status === "draft").length, published: rows.results.filter((item) => item.status === "published").length, archived: rows.results.filter((item) => item.status === "archived").length } });
}

export async function POST(request: Request) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file"), classId = Number(form.get("classId") || 0), operationId = clean(form.get("operationId") || request.headers.get("x-operation-id"), 160);
  if (!Number.isInteger(classId) || classId < 1) return Response.json({ error: "请选择班级" }, { status: 400 });
  const denied = await requireClassAccess(access, classId); if (denied) return denied;
  if (!operationId) return Response.json({ error: "operationId 不能为空" }, { status: 400 });
  const repeated = await env.DB.prepare("SELECT id,status FROM class_files WHERE created_by=? AND operation_id=?").bind(access.id, operationId).first();
  if (repeated) return Response.json({ file: repeated, repeated: true });
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择非空文件" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "单个班级文件不能超过 25MB" }, { status: 413 });
  const extension = file.name.toLowerCase().split(".").pop() || "", mime = allowedMime.has(file.type) ? file.type : fallbackMime[extension] || "";
  if (!mime || !allowedMime.has(mime)) return Response.json({ error: "仅支持图片、音频、PDF、Word、Excel 和 PowerPoint" }, { status: 415 });
  const title = clean(form.get("title"), 160) || clean(file.name.replace(/\.[^.]+$/, ""), 160), description = clean(form.get("description"), 2000), category = clean(form.get("category"), 60) || "学习资料";
  const data = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const safeName = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, "_").slice(0, 120), key = `private/class-files/${classId}/${Date.now()}-${digest.slice(0, 16)}-${safeName}`;
  await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
  let assetId = 0;
  try {
    const asset = await env.DB.prepare("INSERT INTO file_assets(owner_type,owner_id,storage_key,original_name,mime_type,size,fingerprint,purpose,status,created_by) VALUES('user',?,?,?,?,?,?, 'class_file','active',?) RETURNING id").bind(access.id, key, safeName, mime, file.size, digest, access.id).first<{ id: number }>();
    if (!asset?.id) throw new Error("文件记录保存失败"); assetId = asset.id;
    const row = await env.DB.prepare("INSERT INTO class_files(class_id,asset_id,title,description,category,status,operation_id,created_by) VALUES(?,?,?,?,?,'draft',?,?) RETURNING id,status").bind(classId, assetId, title, description || null, category, operationId, access.id).first<Record<string, unknown>>();
    if (!row) throw new Error("班级资料草稿保存失败");
    await env.DB.prepare("INSERT INTO file_leases(asset_id,operation_id,state,linked_entity_type,linked_entity_id) VALUES(?,?,'linked','class_file',?) ON CONFLICT(asset_id) DO UPDATE SET state='linked',linked_entity_type='class_file',linked_entity_id=excluded.linked_entity_id,updated_at=CURRENT_TIMESTAMP").bind(assetId, operationId, String(row.id)).run();
    await audit(access, "upload", "class_file", String(row.id), { classId, assetId, size: file.size, mimeType: mime, status: "draft" });
    return Response.json({ file: { ...row, classId, assetId, title, description, category, fileName: safeName, mimeType: mime, size: file.size } }, { status: 201 });
  } catch (reason) {
    await env.FILES.delete(key); if (assetId) await env.DB.prepare("DELETE FROM file_assets WHERE id=?").bind(assetId).run();
    return Response.json({ error: reason instanceof Error ? reason.message : "班级资料保存失败" }, { status: 500 });
  }
}
