import { audit, isDenied, requirePermission } from "../../../lib/access";
import { createScheduleImportV2, listScheduleImportsV2 } from "../../../lib/v2/schedule-import-service";
import { deferV2BackgroundJob } from "../../../lib/v2/background-dispatch";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  return Response.json({ imports: await listScheduleImportsV2(access, Number(new URL(request.url).searchParams.get("limit") || 30)) });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const operationId = request.headers.get("x-operation-id") || crypto.randomUUID();
  try {
    const result = await createScheduleImportV2(access, await request.formData(), operationId);
    if ("conflict" in result) return Response.json({ error: "这份文件已创建过导入任务", ...result }, { status: 409 });
    if ("job" in result && result.job?.state === "queued") deferV2BackgroundJob(result.job.id);
    await audit(access, "v2_schedule_import_created", "schedule_import", "id" in result ? result.id : null, { operationId });
    return Response.json(result, { status: "repeated" in result ? 200 : 202 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法创建课表导入任务" }, { status: 422 }); }
}
