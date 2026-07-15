import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, filters = [["stage", "stage"], ["grade", "grade"], ["textbookVersion", "textbook_version"], ["volume", "volume"], ["unit", "unit"], ["topic", "topic"]] as const, where = ["status='active'"], bind: unknown[] = [];
  for (const [param, column] of filters) { const value = params.get(param); if (value) { where.push(`${column}=?`); bind.push(value); } }
  const knowledge = params.get("knowledge") || ""; if (knowledge) { where.push("knowledge_points LIKE ?"); bind.push(`%${knowledge}%`); }
  const rows = await env.DB.prepare(`SELECT knowledge_points AS knowledgePoints,answer,analysis,use_count AS useCount FROM questions WHERE ${where.join(" AND ")}`).bind(...bind).all<Record<string, any>>();
  const summary = { total: rows.results.length, missingAnswer: 0, missingAnalysis: 0, useCount: 0 }, groups = new Map<string, { knowledge: string; total: number; missingAnswer: number; missingAnalysis: number; useCount: number }>();
  for (const row of rows.results) {
    const missingAnswer = !String(row.answer || "").trim(), missingAnalysis = !String(row.analysis || "").trim(); summary.missingAnswer += missingAnswer ? 1 : 0; summary.missingAnalysis += missingAnalysis ? 1 : 0; summary.useCount += Number(row.useCount || 0);
    const names = [...new Set(String(row.knowledgePoints || "未标注知识点").split(/[、,，;；/]+/).map((item) => item.trim()).filter(Boolean))];
    for (const name of names) { const item = groups.get(name) || { knowledge: name, total: 0, missingAnswer: 0, missingAnalysis: 0, useCount: 0 }; item.total += 1; item.missingAnswer += missingAnswer ? 1 : 0; item.missingAnalysis += missingAnalysis ? 1 : 0; item.useCount += Number(row.useCount || 0); groups.set(name, item); }
  }
  return Response.json({ summary, knowledge: [...groups.values()].sort((a, b) => b.total - a.total || a.knowledge.localeCompare(b.knowledge, "zh-CN")).slice(0, 50) });
}
