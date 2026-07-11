import { audit, isDenied, requirePermission } from "../../lib/access";

const permissions: Record<string, string> = { lesson: "lessons:read", feedback: "feedback:read", paper: "papers:read", resource: "resources:read" };

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; entityType?: string; entityId?: string | number };
  const entityType = String(body.entityType || ""), permission = permissions[entityType];
  if (!permission || !["print", "export"].includes(String(body.action))) return Response.json({ error: "不支持的日志类型" }, { status: 400 });
  const access = await requirePermission(permission); if (isDenied(access)) return access;
  await audit(access, String(body.action), entityType, body.entityId || null);
  return Response.json({ ok: true });
}
