import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { questions } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionValues } from "../values";

const columns = ["stem", "material", "options", "answer", "analysis", "questionType", "difficulty", "score", "stage", "grade", "textbookVersion", "volume", "unit", "topic", "knowledgePoints", "secondaryKnowledge", "coreCompetencies", "abilityLevel", "source", "year", "region", "examType", "tags"] as const;
const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, format = params.get("format") || "json", status = params.get("status") || "active", ids = (params.get("ids") || "").split(",").map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 300);
  const rows = await getDb().select().from(questions).where(ids.length ? inArray(questions.id, ids) : eq(questions.status, status)).orderBy(desc(questions.updatedAt)).limit(3000), date = new Date().toISOString().slice(0, 10);
  let body = "", type = "application/json;charset=utf-8", extension = "json";
  if (format === "csv") { body = "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((key) => quote(row[key])).join(","))].join("\r\n"); type = "text/csv;charset=utf-8"; extension = "csv"; }
  else if (format === "markdown") { body = rows.map((row, index) => `## ${index + 1}. ${row.stem}\n\n${row.material ? `> ${row.material}\n\n` : ""}${row.options || ""}\n\n- 题型：${row.questionType}\n- 难度：${row.difficulty || "未标注"}\n- 知识点：${row.knowledgePoints || "未标注"}\n- 来源：${row.source || "未标注"}`).join("\n\n---\n\n"); type = "text/markdown;charset=utf-8"; extension = "md"; }
  else body = JSON.stringify({ schema: "zhishi-question-bank/v1", exportedAt: new Date().toISOString(), answerIncluded: true, questions: rows }, null, 2);
  await audit(access, "export_questions", "question", ids.join(",") || status, { format, count: rows.length, answerIncluded: format !== "markdown" });
  return new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`知师研室题库-${status}-${date}.${extension}`)}`, "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const payload = await request.json() as { schema?: string; questions?: Array<Record<string, unknown>> }, input = Array.isArray(payload.questions) ? payload.questions.slice(0, 1000) : [];
  if (!input.length) return Response.json({ error: "文件中没有可导入的题目" }, { status: 400 });
  const db = getDb(), prepared = input.map((item) => questionValues({ ...item, id: undefined, status: "review", reviewed: false, reviewStatus: "pending", recordedBy: access.name })), fingerprints = [...new Set(prepared.map((item) => item.fingerprint))], existing = new Set((await db.select({ fingerprint: questions.fingerprint }).from(questions).where(inArray(questions.fingerprint, fingerprints))).map((item) => item.fingerprint)), unique = prepared.filter((item) => !existing.has(item.fingerprint));
  for (let index = 0; index < unique.length; index += 20) await db.insert(questions).values(unique.slice(index, index + 20));
  await audit(access, "import_questions", "question", undefined, { schema: payload.schema || "unknown", total: input.length, imported: unique.length, duplicates: input.length - unique.length });
  return Response.json({ imported: unique.length, duplicates: input.length - unique.length, status: "review" }, { status: 201 });
}
