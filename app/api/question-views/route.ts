import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { savedQuestionViews } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";

const allowedKeys = new Set(["q", "stage", "grade", "textbookVersion", "volume", "unit", "topic", "knowledge", "type", "difficulty", "source", "region", "year", "flag", "issue", "status", "sort"]);

function cleanFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => allowedKeys.has(key))
    .map(([key, item]) => [key, String(item ?? "").trim().slice(0, 120)])
    .filter(([, item]) => item));
}

export async function GET() {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const views = await getDb().select().from(savedQuestionViews).where(eq(savedQuestionViews.ownerId, access.id)).orderBy(desc(savedQuestionViews.updatedAt));
  return Response.json({ views: views.map((view) => { try { return { ...view, filters: cleanFilters(JSON.parse(view.filtersJson)) }; } catch { return { ...view, filters: {} }; } }) });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { name?: unknown; filters?: unknown }, name = String(body.name || "").trim().slice(0, 40), filters = cleanFilters(body.filters);
  if (!name) return Response.json({ error: "请填写筛选方案名称" }, { status: 400 });
  if (!Object.keys(filters).length) return Response.json({ error: "请至少设置一个筛选条件后再保存" }, { status: 400 });
  const now = new Date().toISOString(), db = getDb();
  const [same] = await db.select().from(savedQuestionViews).where(and(eq(savedQuestionViews.ownerId, access.id), eq(savedQuestionViews.name, name))).limit(1);
  if (same) {
    const [view] = await db.update(savedQuestionViews).set({ filtersJson: JSON.stringify(filters), updatedAt: now }).where(eq(savedQuestionViews.id, same.id)).returning();
    await audit(access, "update", "saved_question_view", view.id, { name });
    return Response.json({ view: { ...view, filters } });
  }
  const [view] = await db.insert(savedQuestionViews).values({ ownerId: access.id, name, filtersJson: JSON.stringify(filters) }).returning();
  await audit(access, "create", "saved_question_view", view.id, { name });
  return Response.json({ view: { ...view, filters } }, { status: 201 });
}
