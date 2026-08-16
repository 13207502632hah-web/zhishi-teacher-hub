import { isDenied, requirePermission } from "../../../../lib/access";
import { getScheduleImportV2 } from "../../../../lib/v2/schedule-import-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const item = await getScheduleImportV2(access, (await context.params).id);
  return item ? Response.json(item) : Response.json({ error: "导入任务不存在" }, { status: 404 });
}
