import { inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { questions } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { ids?: number[]; action?: string; value?: string }, ids = [...new Set((body.ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))].slice(0, 100);
  if (!ids.length) return Response.json({ error: "请至少选择一道题目" }, { status: 400 });
  const action = String(body.action || ""), updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (action === "tags") updates.tags = String(body.value || "").trim();
  else if (action === "knowledge") updates.knowledgePoints = String(body.value || "").trim();
  else if (action === "status") updates.status = body.value === "review" ? "review" : "active";
  else return Response.json({ error: "不支持的批量操作" }, { status: 400 });
  await getDb().update(questions).set(updates).where(inArray(questions.id, ids));
  await audit(access, "batch_update", "question", ids.join(","), { action, count: ids.length });
  return Response.json({ ok: true, count: ids.length });
}
