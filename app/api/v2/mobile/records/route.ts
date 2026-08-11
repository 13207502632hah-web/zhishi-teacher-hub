import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { listMobileRecords, upsertMobileRecord } from "../../../../lib/v2/mobile-record-service";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams;
  const result = await listMobileRecords(access, Math.max(0, Number(params.get("cursor") || 0)), Number(params.get("limit") || 100));
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  try {
    const body = await request.json() as Record<string, unknown>, operationId = request.headers.get("x-operation-id") || String(body.operationId || "");
    const result = await upsertMobileRecord(access, { ...body, operationId }, body.source === "ios" ? "ios" : "web");
    if (result.conflict) return Response.json({ error: "记录已在其他设备更新", code: "VERSION_CONFLICT", ...result }, { status: 409 });
    await audit(access, result.repeated ? "mobile_record_replayed" : "mobile_record_saved", "mobile_record", result.record?.id || null, { source: result.record?.source, version: result.record?.version });
    return Response.json(result, { status: result.repeated ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "记录保存失败" }, { status: 400 }); }
}
