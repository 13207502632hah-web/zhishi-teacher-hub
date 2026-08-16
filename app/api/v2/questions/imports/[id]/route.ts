import { isDenied, requirePermission } from "../../../../../lib/access";
import { getQuestionImportV2 } from "../../../../../lib/v2/question-import-service";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("questions:read"); if (isDenied(access)) return access; const item = await getQuestionImportV2(access, (await context.params).id); return item ? Response.json(item) : Response.json({ error: "导入任务不存在" }, { status: 404 }); }
