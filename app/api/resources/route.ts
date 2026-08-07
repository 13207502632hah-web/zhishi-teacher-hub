import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { resources } from "../../../db/schema";
import { audit, can, getAccess, isDenied, requirePermission } from "../../lib/access";

function isSafeExternalUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const q = searchParams.get("q") || "";
  const scope = searchParams.get("scope") || "all";
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 20) : null;
  const access = await getAccess(), search = q ? or(like(resources.title, `%${q}%`), like(resources.tags, `%${q}%`), like(resources.content, `%${q}%`)) : undefined;
  const visibility = scope === "public" ? eq(resources.visibility, "public") : access?.role === "teacher" ? undefined : access && can(access, "resources:private") ? inArray(resources.visibility, ["public", "private"]) : eq(resources.visibility, "public");
  const base = visibility && search ? and(visibility, search) : visibility || search;
  const rows = limit ? await getDb().select().from(resources).where(base).orderBy(desc(resources.updatedAt)).limit(limit) : await getDb().select().from(resources).where(base).orderBy(desc(resources.updatedAt));
  const [publicRow] = await getDb().select({ count: sql<number>`count(*)` }).from(resources).where(eq(resources.visibility, "public"));
  const popularTags = Array.from(rows.filter((row) => row.visibility === "public").flatMap((row) => String(row.tags || "").split(/[,，、]/)).map((tag) => tag.trim()).filter(Boolean).reduce((counts, tag) => counts.set(tag, (counts.get(tag) || 0) + 1), new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
  return Response.json({ resources: rows, canWrite: Boolean(access && can(access, "resources:write")), summary: { publicCount: Number(publicRow?.count || 0), popularTags } });
}

export async function POST(request: Request) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>;
  if (!String(body.title || "").trim()) return Response.json({ error: "资源名称不能为空" }, { status: 400 });
  const url = String(body.url || "").trim();
  if (url && !isSafeExternalUrl(url)) return Response.json({ error: "不支持的外部链接协议，仅允许 http:// 或 https://" }, { status: 400 });
  const [resource] = await getDb().insert(resources).values({ title: String(body.title).trim(), type: String(body.type || "备课素材"), url, tags: String(body.tags || ""), content: String(body.content || ""), sourceRef: String(body.sourceRef || "manual"), visibility: body.visibility === "public" ? "public" : "private", ownerId: access.id }).returning();
  await audit(access, "create", "resource", resource.id, { visibility: resource.visibility });
  return Response.json({ resource }, { status: 201 });
}
