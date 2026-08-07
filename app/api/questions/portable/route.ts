import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { questions } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { PORTABLE_COLUMNS, parseQuestionCsv, portableTemplateCsv, portableTemplateJson, quoteCsvCell } from "../../../lib/question-portable";
import { questionValues } from "../values";
import { BRAND_NAME } from "../../../lib/brand";

const columns = PORTABLE_COLUMNS;
const quote = quoteCsvCell;

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, format = params.get("format") || "json", template = params.get("template") === "1";
  if (template) {
    if (format === "csv") {
      await audit(access, "export_questions", "question", "template", { format: "csv", template: true, count: 1 });
      return new Response(portableTemplateCsv(), { headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${BRAND_NAME}题库导入模板.csv`)}`, "Cache-Control": "no-store" } });
    }
    await audit(access, "export_questions", "question", "template", { format: "json", template: true, count: 1 });
    return Response.json(portableTemplateJson(), { headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${BRAND_NAME}题库导入模板.json`)}`, "Cache-Control": "no-store" } });
  }
  const status = params.get("status") || "active", ids = (params.get("ids") || "").split(",").map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 300);
  const rows = await getDb().select().from(questions).where(ids.length ? inArray(questions.id, ids) : eq(questions.status, status)).orderBy(desc(questions.updatedAt)).limit(3000), date = new Date().toISOString().slice(0, 10);
  let body = "", type = "application/json;charset=utf-8", extension = "json";
  if (format === "csv") { body = "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((key) => quote(row[key])).join(","))].join("\r\n"); type = "text/csv;charset=utf-8"; extension = "csv"; }
  else if (format === "markdown") { body = rows.map((row, index) => `## ${index + 1}. ${row.stem}\n\n${row.material ? `> ${row.material}\n\n` : ""}${row.options || ""}\n\n- 题型：${row.questionType}\n- 难度：${row.difficulty || "未标注"}\n- 知识点：${row.knowledgePoints || "未标注"}\n- 来源：${row.source || "未标注"}`).join("\n\n---\n\n"); type = "text/markdown;charset=utf-8"; extension = "md"; }
  else body = JSON.stringify({ schema: "zhishi-question-bank/v1", exportedAt: new Date().toISOString(), answerIncluded: true, questions: rows }, null, 2);
  await audit(access, "export_questions", "question", ids.join(",") || status, { format, count: rows.length, answerIncluded: format !== "markdown" });
  return new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${BRAND_NAME}题库-${status}-${date}.${extension}`)}`, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const contentType = request.headers.get("content-type") || "", raw = await request.text();
  let input: Array<Record<string, unknown>> = [], schema = "zhishi-question-bank/v1", isCsv = false;
  try {
    if (contentType.includes("csv")) {
      isCsv = true;
      schema = "zhishi-question-bank/csv";
      input = parseQuestionCsv(raw).slice(0, 1000);
    } else {
      const payload = JSON.parse(raw) as { schema?: string; questions?: Array<Record<string, unknown>> };
      schema = payload.schema || "zhishi-question-bank/v1";
      input = Array.isArray(payload.questions) ? payload.questions.slice(0, 1000) : [];
    }
  } catch {
    return Response.json({ error: "题库文件格式无法解析；请使用导出的 JSON 或 CSV 模板" }, { status: 400 });
  }
  if (!input.length) return Response.json({ error: "文件中没有可导入的题目；请填写题干并保留表头" }, { status: 400 });
  const db = getDb(), prepared = input.map((item) => questionValues({ ...item, id: undefined, status: "review", reviewed: false, reviewStatus: "pending", recordedBy: access.name })), fingerprints = [...new Set(prepared.map((item) => item.fingerprint))], existing = new Set((await db.select({ fingerprint: questions.fingerprint }).from(questions).where(inArray(questions.fingerprint, fingerprints))).map((item) => item.fingerprint)), unique = prepared.filter((item) => !existing.has(item.fingerprint));
  for (let index = 0; index < unique.length; index += 20) await db.insert(questions).values(unique.slice(index, index + 20));
  await audit(access, "import_questions", "question", undefined, { schema, format: isCsv ? "csv" : "json", total: input.length, imported: unique.length, duplicates: input.length - unique.length });
  return Response.json({ imported: unique.length, duplicates: input.length - unique.length, status: "review" }, { status: 201 });
}
