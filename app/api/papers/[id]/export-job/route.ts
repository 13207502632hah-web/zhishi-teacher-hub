import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

const modes = ["student", "teacher", "answer", "analysis"];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as { mode?: string }, mode = String(body.mode || "student");
  if (!Number.isFinite(id) || !modes.includes(mode)) return Response.json({ error: "导出参数无效" }, { status: 400 });
  const paper = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(id).first(); if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const jobId = `paper-${id}-${mode}-pdf-${Math.floor(Date.now() / 30000)}`, existing = await env.DB.prepare("SELECT status,error FROM export_jobs WHERE id=?").bind(jobId).first<{ status: string; error: string }>();
  if (!existing) await env.DB.prepare("INSERT INTO export_jobs(id,paper_id,format,mode,status,created_by) VALUES(?,?,'pdf',?,'processing',?)").bind(jobId, id, mode, access.id).run();
  return Response.json({ jobId, status: existing?.status || "processing", error: existing?.error || null });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), form = await request.formData(), jobId = String(form.get("jobId") || ""), file = form.get("file");
  const job = await env.DB.prepare("SELECT mode FROM export_jobs WHERE id=? AND paper_id=? AND format='pdf'").bind(jobId, id).first<{ mode: string }>();
  if (!job || !(file instanceof File)) return Response.json({ error: "PDF 导出任务不存在" }, { status: 404 });
  const buffer = await file.arrayBuffer(), signature = new TextDecoder().decode(buffer.slice(0, 4)); if (signature !== "%PDF") return Response.json({ error: "生成结果不是有效 PDF" }, { status: 415 });
  const key = `paper-exports/${new Date().toISOString().slice(0, 10)}/${jobId}.pdf`; await env.FILES.put(key, buffer, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare("UPDATE export_jobs SET status='completed',result_key=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(key, jobId).run(); await audit(access, "export_pdf", "paper", id, { mode: job.mode, jobId });
  return Response.json({ jobId, status: "completed" });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), jobId = new URL(request.url).searchParams.get("jobId") || "", job = await env.DB.prepare("SELECT status,result_key AS resultKey,error FROM export_jobs WHERE id=? AND paper_id=? AND format='pdf'").bind(jobId, id).first<{ status: string; resultKey: string; error: string }>();
  if (!job) return Response.json({ error: "导出任务不存在" }, { status: 404 });
  if (job.status !== "completed" || !job.resultKey) return Response.json({ jobId, status: job.status, error: job.error || null });
  const object = await env.FILES.get(job.resultKey); if (!object) return Response.json({ error: "PDF 文件已不可用" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": "application/pdf", "X-Export-Job": jobId, "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as { jobId?: string; error?: string }, jobId = String(body.jobId || "");
  const result = await env.DB.prepare("UPDATE export_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND paper_id=? AND format='pdf'").bind(String(body.error || "PDF 生成失败").slice(0, 500), jobId, id).run();
  return Response.json({ jobId, status: "failed", updated: Boolean(result.success) });
}
