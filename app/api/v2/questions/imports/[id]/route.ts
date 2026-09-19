import { isDenied, requirePermission } from "../../../../../lib/access";
import { runV2BackgroundJob } from "../../../../../lib/v2/background-dispatch";
import { getQuestionImportV2 } from "../../../../../lib/v2/question-import-service";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const access = await requirePermission("questions:read"); if (isDenied(access)) return access; const id = (await context.params).id; let item = await getQuestionImportV2(access, id); if (item && ["queued", "running"].includes(item.job.state)) { await runV2BackgroundJob(id); item = await getQuestionImportV2(access, id); } return item ? Response.json(item) : Response.json({ error: "导入任务不存在" }, { status: 404 }); }
