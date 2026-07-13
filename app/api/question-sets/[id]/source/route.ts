import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), record = await env.DB.prepare("SELECT source_file AS sourceFile,source_document AS sourceDocument FROM question_sets WHERE id=?").bind(id).first<{ sourceFile: string; sourceDocument: string }>();
  if (!record?.sourceDocument) return Response.json({ error: "原始 Word 文件不存在" }, { status: 404 });
  const object = await env.FILES.get(record.sourceDocument); if (!object) return Response.json({ error: "原始 Word 文件已不可用" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.sourceFile || "原始试卷.docx")}`, "Cache-Control": "private, no-store" } });
}
