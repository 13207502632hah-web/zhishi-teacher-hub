import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { createQuestionImportV2 } from "../../../../lib/v2/question-import-service";
import { deferV2BackgroundJob } from "../../../../lib/v2/background-dispatch";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access; const operationId = request.headers.get("x-operation-id") || crypto.randomUUID();
  try { const result = await createQuestionImportV2(access, await request.formData(), operationId); if (result.job?.state === "queued") deferV2BackgroundJob(result.job.id); await audit(access, "v2_question_import_created", "v2_question_import", result.job.id, { operationId }); return Response.json(result, { status: "repeated" in result ? 200 : 202 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法创建题库导入任务" }, { status: 422 }); }
}
