import { audit, isDenied, requirePermission } from "../../../../../lib/access";
import { deleteMobileRecord } from "../../../../../lib/v2/mobile-record-service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  try {
    const { id } = await context.params, body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const operationId = request.headers.get("x-operation-id") || String(body.operationId || ""), baseVersion = Number(body.baseVersion || 0);
    if (operationId.length < 8) return Response.json({ error: "operationId 无效" }, { status: 400 });
    const result = await deleteMobileRecord(access, id, operationId, baseVersion);
    if (!result) return Response.json({ error: "记录不存在" }, { status: 404 });
    if (result.conflict) return Response.json({ error: "记录已在其他设备更新", code: "VERSION_CONFLICT", ...result }, { status: 409 });
    await audit(access, "mobile_record_deleted", "mobile_record", id, { operationId }); return Response.json(result);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 }); }
}
