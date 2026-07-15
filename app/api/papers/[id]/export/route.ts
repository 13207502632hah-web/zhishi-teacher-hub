import { env } from "cloudflare:workers";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

const safe = (value: unknown) => String(value || "").replace(/[\\/:*?"<>|]/g, "-").trim();
const json = <T,>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value || "")) as T; } catch { return fallback; } };
const chineseFont = "STHeiti";
const lines = (value: unknown) => String(value || "").split(/\r?\n/).filter(Boolean).map((line) => new Paragraph({ children: [new TextRun({ text: line, font: chineseFont, size: 22 })], spacing: { after: 80 } }));

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), mode = new URL(request.url).searchParams.get("mode") || "student";
  if (!Number.isFinite(id) || !["student", "teacher", "answer", "analysis"].includes(mode)) return Response.json({ error: "导出参数无效" }, { status: 400 });
  const paper = await env.DB.prepare("SELECT * FROM papers WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const rows = await env.DB.prepare("SELECT q.*,pq.position,pq.score AS paper_score,pq.group_title,pq.answer_space FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position").bind(id).all<Record<string, unknown>>();
  const date = new Date().toISOString().slice(0, 10), modeName: Record<string, string> = { student: "学生版", teacher: "教师版", answer: "答案版", analysis: "解析版" }, filename = `${safe(paper.title)}-${modeName[mode]}-${date}.docx`, jobId = `paper-${id}-${mode}-docx-${Math.floor(Date.now() / 30000)}`;
  const existing = await env.DB.prepare("SELECT status,result_key AS resultKey FROM export_jobs WHERE id=?").bind(jobId).first<{ status: string; resultKey: string }>();
  if (existing?.status === "completed" && existing.resultKey) { const object = await env.FILES.get(existing.resultKey); if (object) return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "X-Export-Job": jobId, "Cache-Control": "private, no-store" } }); }
  await env.DB.prepare("INSERT OR IGNORE INTO export_jobs(id,paper_id,format,mode,status,created_by) VALUES(?,?, 'docx',?,'queued',?)").bind(jobId, id, mode, access.id).run();
  await env.DB.prepare("UPDATE export_jobs SET status='processing',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
  const children: Array<Paragraph | Table> = [
    new Paragraph({ alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [new TextRun({ text: String(paper.title), bold: true, font: chineseFont, size: 34 })], spacing: { after: 240 } }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `姓名：________  班级：________  日期：________${paper.duration_minutes ? `  限时：${paper.duration_minutes}分钟` : ""}  总分：${paper.total_score || 0}分`, font: chineseFont, size: 21 })], spacing: { after: 220 } }),
  ];
  if (paper.instructions) children.push(new Paragraph({ children: [new TextRun({ text: String(paper.instructions), font: chineseFont, size: 21 })], spacing: { after: 180 } }));
  let previousGroup = "";
  for (let index = 0; index < rows.results.length; index += 1) {
    const question = rows.results[index];
    const group = String(question.group_title || question.question_group || "");
    if (group && group !== previousGroup) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: group, bold: true, font: chineseFont, size: 26 })], keepNext: true })); previousGroup = group; }
    if (question.material) children.push(new Paragraph({ children: [new TextRun({ text: String(question.material), font: chineseFont, size: 22 })], shading: { fill: "F4F6EF" }, spacing: { after: 100 }, keepNext: true }));
    for (const attachment of json<Array<{ src?: string; storageKey?: string; mimeType?: string; alt?: string }>>(question.attachments, [])) {
      const match = String(attachment.src || "").match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
      let bytes: Uint8Array | null = match ? Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)) : null;
      let type: "png" | "jpg" = match?.[1].toLowerCase() === "png" ? "png" : "jpg";
      if (!bytes && attachment.storageKey) {
        const object = await env.FILES.get(attachment.storageKey);
        if (object) { bytes = new Uint8Array(await new Response(object.body).arrayBuffer()); type = String(attachment.mimeType || object.httpMetadata?.contentType).includes("png") ? "png" : "jpg"; }
      }
      if (!bytes) continue;
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: bytes, type, transformation: { width: 480, height: 270 }, altText: { title: attachment.alt || "试题图片", description: attachment.alt || "试题图片", name: attachment.alt || "试题图片" } })], spacing: { after: 100 } }));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: `${index + 1}．${question.stem}（${question.paper_score || question.score || 0}分）`, font: chineseFont, size: 22 })], spacing: { before: 120, after: 80 }, keepNext: true }));
    children.push(...lines(question.options));
    for (const table of json<Array<{ rows?: string[][] }>>(question.tables, [])) if (table.rows?.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: table.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, font: chineseFont, size: 20 })] })] })) })) }));
    if (mode === "student") for (let line = 0; line < Math.max(1, Number(question.answer_space || 2)); line++) children.push(new Paragraph({ children: [new TextRun({ text: "____________________________________________________________________________", color: "777777" })] }));
    if (["teacher", "answer", "analysis"].includes(mode)) children.push(new Paragraph({ children: [new TextRun({ text: `答案：${question.answer || "待补充"}`, bold: true, font: chineseFont, size: 21 })], spacing: { before: 80 } }));
    if (["teacher", "analysis"].includes(mode)) children.push(new Paragraph({ children: [new TextRun({ text: `解析：${question.analysis || "待补充"}`, font: chineseFont, size: 21 })] }), new Paragraph({ children: [new TextRun({ text: `知识点：${question.knowledge_points || "待标注"}`, color: "41644A", font: chineseFont, size: 20 })] }));
  }
  const doc = new Document({ styles: { default: { document: { run: { font: chineseFont, size: 22 }, paragraph: { spacing: { line: 360 } } } } }, sections: [{ properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children }] });
  try {
    const blob = await Packer.toBlob(doc), resultKey = `paper-exports/${date}/${jobId}.docx`; await env.FILES.put(resultKey, blob, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, customMetadata: { filename, mode } });
    await env.DB.prepare("UPDATE export_jobs SET status='completed',result_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(resultKey, jobId).run();
    await audit(access, "export_docx", "paper", id, { mode, filename, questionCount: rows.results.length, jobId });
    return new Response(blob, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "X-Export-Job": jobId, "Cache-Control": "private, no-store" } });
  } catch (reason) { const error = reason instanceof Error ? reason.message : "Word 生成失败"; await env.DB.prepare("UPDATE export_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error.slice(0, 500), jobId).run(); return Response.json({ error, jobId, status: "failed" }, { status: 500 }); }
}
