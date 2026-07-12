import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { resources } from "../../../db/schema";
import { audit, can, getAccess, isDenied, requirePermission } from "../../lib/access";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") || "";
  const access = await getAccess(), search = q ? or(like(resources.title, `%${q}%`), like(resources.tags, `%${q}%`), like(resources.content, `%${q}%`)) : undefined;
  const visibility = access?.role === "teacher" ? undefined : access && can(access, "resources:private") ? inArray(resources.visibility, ["public", "private"]) : eq(resources.visibility, "public");
  const rows = await getDb().select().from(resources).where(visibility && search ? and(visibility, search) : visibility || search).orderBy(desc(resources.updatedAt));
  return Response.json({ resources: rows, canWrite: Boolean(access && can(access, "resources:write")) });
}

export async function POST(request: Request) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>;
  if (!String(body.title || "").trim()) return Response.json({ error: "资源名称不能为空" }, { status: 400 });
  const [resource] = await getDb().insert(resources).values({ title: String(body.title), type: String(body.type || "备课素材"), url: String(body.url || ""), tags: String(body.tags || ""), content: String(body.content || ""), sourceRef: String(body.sourceRef || "manual"), visibility: body.visibility === "public" ? "public" : "private", ownerId: access.id }).returning();
  await audit(access, "create", "resource", resource.id, { visibility: resource.visibility });
  return Response.json({ resource }, { status: 201 });
}
