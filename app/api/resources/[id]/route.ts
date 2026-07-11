import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { resources } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const { id } = await context.params;
  await getDb().delete(resources).where(eq(resources.id, Number(id)));
  await audit(access, "delete", "resource", id);
  return Response.json({ ok: true });
}
