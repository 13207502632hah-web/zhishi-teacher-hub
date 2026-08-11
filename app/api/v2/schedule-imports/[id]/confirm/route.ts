import { audit, isDenied, requirePermission } from "../../../../../lib/access";
import { confirmScheduleImportV2 } from "../../../../../lib/v2/schedule-import-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = (await context.params).id, body = await request.json().catch(() => ({})) as Record<string, unknown>, operationId = String(body.operationId || request.headers.get("x-operation-id") || crypto.randomUUID());
  try { const result = await confirmScheduleImportV2(access, id, operationId); if (!result) return Response.json({ error: "导入任务不存在" }, { status: 404 }); await audit(access, "v2_schedule_import_confirmed", "schedule_import", id, { operationId, result }); return Response.json(result); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法确认导入" }, { status: 409 }); }
}
