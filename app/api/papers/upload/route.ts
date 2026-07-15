import { getDb } from "../../../../db";
import { paperFiles, papers } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

const allowed = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file"), title = String(form.get("title") || "").trim(), versionType = String(form.get("versionType") || "student");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "请选择完整试卷文件" }, { status: 400 });
  if (!allowed.has(file.type) || file.size > 30 * 1024 * 1024) return Response.json({ error: "仅支持30MB以内的DOCX、PDF、JPG、PNG或WebP文件" }, { status: 415 });
  const buffer = await file.arrayBuffer(), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const existing = await env.DB.prepare("SELECT pf.id,pf.paper_id AS paperId FROM paper_files pf WHERE pf.fingerprint=? AND pf.version_type=? LIMIT 1").bind(digest, versionType).first<{ id: number; paperId: number }>();
  if (existing) return Response.json({ error: "这份文件已经上传过", paperId: existing.paperId }, { status: 409 });
  const db = getDb(), [paper] = await db.insert(papers).values({ title: title || file.name.replace(/\.[^.]+$/, ""), type: String(form.get("type") || "完整试卷"), stage: String(form.get("stage") || ""), grade: String(form.get("grade") || ""), textbookVersion: String(form.get("textbookVersion") || ""), year: Number(form.get("year") || 0) || null, academicYear: String(form.get("academicYear") || ""), examCategory: String(form.get("examCategory") || ""), semester: String(form.get("semester") || ""), province: String(form.get("province") || ""), city: String(form.get("city") || ""), district: String(form.get("district") || ""), examDate: String(form.get("examDate") || ""), region: String(form.get("region") || ""), school: String(form.get("school") || ""), source: String(form.get("source") || ""), tags: String(form.get("tags") || ""), useStatus: "unused", parseStatus: "queued", status: "completed" }).returning();
  const key = `whole-papers/${paper.id}/${digest}-${encodeURIComponent(file.name)}`;
  try {
    await env.FILES.put(key, buffer, { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name, versionType, uploadedBy: String(access.id) } });
    const [record] = await db.insert(paperFiles).values({ paperId: paper.id, versionType, originalName: file.name, storageKey: key, mimeType: file.type, size: file.size, fingerprint: digest, parseStatus: "queued", parseMessage: "原卷已保存，可立即预览或打印；后台识别等待处理", uploadedBy: access.id }).returning();
    await audit(access, "upload_whole_paper", "paper", paper.id, { fileId: record.id, versionType, size: file.size });
    return Response.json({ paper, file: record }, { status: 201 });
  } catch (reason) {
    await db.delete(papers).where(eq(papers.id, paper.id));
    return Response.json({ error: reason instanceof Error ? reason.message : "试卷文件保存失败" }, { status: 500 });
  }
}
