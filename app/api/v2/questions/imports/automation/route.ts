import { env } from "cloudflare:workers";
import { audit, isDenied } from "../../../../../lib/access";
import { requireQuestionImportAutomation } from "../../../../../lib/question-import-automation";
import { deferV2BackgroundJob } from "../../../../../lib/v2/background-dispatch";
import { createQuestionImportV2, getQuestionImportV2 } from "../../../../../lib/v2/question-import-service";
import { readQuestionImportForm } from "../../../../../lib/v2/question-import-request";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const access = await requireQuestionImportAutomation(request);
  if (isDenied(access)) return access;
  const operationId = String(request.headers.get("x-operation-id") || "").trim();
  if (!/^[A-Za-z0-9:._-]{8,200}$/.test(operationId)) {
    return Response.json({ error: "自动化导入必须提供稳定的 X-Operation-Id" }, { status: 400, headers: noStore });
  }
  try {
    const result = await createQuestionImportV2(access, await readQuestionImportForm(request), operationId);
    if (result.job?.state === "queued") deferV2BackgroundJob(result.job.id);
    await audit(access, "automation_question_import_created", "v2_question_import", result.job.id, { operationId });
    return Response.json(result, { status: "repeated" in result ? 200 : 202, headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法创建题库自动化导入任务" }, { status: 422, headers: noStore });
  }
}

export async function GET(request: Request) {
  const access = await requireQuestionImportAutomation(request);
  if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams;
  const id = String(params.get("id") || "").trim();
  if (id) {
    const item = await getQuestionImportV2(access, id);
    if (item && ["queued", "running"].includes(item.job.state)) deferV2BackgroundJob(id);
    return item ? Response.json(item, { headers: noStore }) : Response.json({ error: "导入任务不存在" }, { status: 404, headers: noStore });
  }

  const sourceFingerprint = String(params.get("sourceFingerprint") || "").trim().toLowerCase();
  if (sourceFingerprint && !/^[a-f0-9]{64}$/.test(sourceFingerprint)) {
    return Response.json({ error: "文件指纹格式不正确" }, { status: 400, headers: noStore });
  }
  if (sourceFingerprint) {
    const existing = await env.DB.prepare("SELECT id,name,source_file AS sourceFile,status,created_at AS createdAt FROM question_sets WHERE source_fingerprint=? ORDER BY id DESC LIMIT 1").bind(sourceFingerprint).first<Record<string, unknown>>();
    return Response.json({ existing: existing || null }, { headers: noStore });
  }

  const rows = await env.DB.prepare("SELECT qs.id,qs.name,qs.source_file AS sourceFile,qs.source_fingerprint AS sourceFingerprint,qs.status,qs.created_at AS createdAt,count(q.id) AS questionCount FROM question_sets qs LEFT JOIN questions q ON q.question_set_id=qs.id WHERE qs.status='active' GROUP BY qs.id,qs.name,qs.source_file,qs.source_fingerprint,qs.status,qs.created_at ORDER BY qs.id DESC LIMIT 500").all<Record<string, unknown>>();
  return Response.json({ imports: rows.results }, { headers: noStore });
}
