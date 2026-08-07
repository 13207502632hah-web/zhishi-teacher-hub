import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { resources } from "../../../../db/schema";
import { audit, can, getAccess, isDenied, requirePermission } from "../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return Response.json({ error: "资源不存在或未公开" }, { status: 404 });
  const access = await getAccess();
  const canReadPrivate = Boolean(access && can(access, "resources:private"));
  const where = canReadPrivate ? eq(resources.id, numericId) : and(eq(resources.id, numericId), eq(resources.visibility, "public"));
  const [resource] = await getDb().select().from(resources).where(where);
  if (!resource) return Response.json({ error: "资源不存在或未公开" }, { status: 404 });
  return Response.json({ resource, canManage: Boolean(access && can(access, "resources:write")) });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const { id } = await context.params;
  const [deleted] = await getDb().delete(resources).where(eq(resources.id, Number(id))).returning({ id: resources.id });
  if (!deleted) return Response.json({ error: "资源不存在或已删除" }, { status: 404 });
  await audit(access, "delete", "resource", id);
  return Response.json({ ok: true });
}
