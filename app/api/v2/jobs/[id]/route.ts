import { audit, can, isDenied, requirePermission, type AccessContext } from "../../../../lib/access";
import { env } from "cloudflare:workers";
import { getJob, requestJobCancel, retryBackgroundJob } from "../../../../lib/v2/job-service";
import { deferV2BackgroundJob } from "../../../../lib/v2/background-dispatch";

const jobWritePermission = (type: string) => type === "question-import" ? "questions:write" : ["schedule-import", "schedule-confirm"].includes(type) ? "lessons:write" : null;

function denyJobMutation(access: AccessContext, type: string) {
  const permission = jobWritePermission(type);
  return !permission || !can(access, permission) ? Response.json({ error: "当前账号没有修改该任务的权限" }, { status: 403 }) : null;
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  const { id } = await context.params, job = await getJob(access, id);
  return job ? Response.json({ job }, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "任务不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  const { id } = await context.params, body = await request.json() as Record<string, unknown>;
  if (body.action === "cancel") {
    const current = await getJob(access, id);
    if (!current) return Response.json({ error: "任务不存在" }, { status: 404 });
    const denied = denyJobMutation(access, current.type); if (denied) return denied;
    if (!await requestJobCancel(access, id)) return Response.json({ error: "任务不存在或已不可取消" }, { status: 409 });
    const cancelled = await getJob(access, id);
    if (current?.type === "schedule-confirm" && cancelled?.state === "cancelled") await env.DB.prepare("UPDATE v2_schedule_imports SET state=CASE WHEN EXISTS(SELECT 1 FROM v2_schedule_rows WHERE import_id=v2_schedule_imports.id AND state IN ('created','updated','skipped')) THEN 'partial' ELSE 'waiting_review' END,updated_at=CURRENT_TIMESTAMP WHERE job_id=?").bind(id).run();
    await audit(access, "cancel_requested", "v2_job", id);
    return Response.json({ job: await getJob(access, id) });
  }
  if (body.action === "retry") {
    const operationId = String(request.headers.get("X-Operation-Id") || "").trim();
    if (!/^[A-Za-z0-9:._-]{8,200}$/.test(operationId)) return Response.json({ error: "重试必须提供稳定的操作编号" }, { status: 400 });
    const current = await getJob(access, id);
    if (!current) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (!["schedule-import", "schedule-confirm", "question-import"].includes(current.type)) return Response.json({ error: "该任务需要回到原功能重新生成，以重新校验最新业务证据" }, { status: 409 });
    const denied = denyJobMutation(access, current.type); if (denied) return denied;
    const retried = await retryBackgroundJob(access, id, operationId);
    if (!retried) return Response.json({ error: "当前任务不可重试" }, { status: 409 });
    const { job } = retried;
    if (!retried.repeated && current.type === "schedule-confirm") await env.DB.prepare("UPDATE v2_schedule_imports SET state='confirming',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND state IN ('waiting_review','partial','failed')").bind(id).run();
    if (job && ["schedule-import", "schedule-confirm", "question-import"].includes(job.type)) deferV2BackgroundJob(id);
    if (!retried.repeated) await audit(access, "retry", "v2_job", id, { operationId });
    return Response.json({ job });
  }
  return Response.json({ error: "不支持的任务操作" }, { status: 400 });
}
