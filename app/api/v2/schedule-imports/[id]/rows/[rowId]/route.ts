import { audit, isDenied, requirePermission } from "../../../../../../lib/access";
import { updateScheduleRowV2 } from "../../../../../../lib/v2/schedule-import-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; rowId: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const { id, rowId } = await context.params, numericId = Number(rowId); if (!Number.isInteger(numericId) || numericId < 1) return Response.json({ error: "行号无效" }, { status: 400 });
  try { const operationId = request.headers.get("x-operation-id") || crypto.randomUUID(), item = await updateScheduleRowV2(access, id, numericId, await request.json(), operationId); if (!item) return Response.json({ error: "导入行不存在" }, { status: 404 }); await audit(access, "v2_schedule_row_updated", "schedule_import", id, { rowId: numericId, operationId }); return Response.json(item); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法修改导入行" }, { status: 409 }); }
}
