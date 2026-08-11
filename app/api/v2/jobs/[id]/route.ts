import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { getJob, requestJobCancel, updateJob } from "../../../../lib/v2/job-service";
import { deferV2BackgroundJob } from "../../../../lib/v2/background-dispatch";

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
    if (!await requestJobCancel(access, id)) return Response.json({ error: "任务不存在或已不可取消" }, { status: 409 });
    await audit(access, "cancel_requested", "v2_job", id);
    return Response.json({ job: await getJob(access, id) });
  }
  if (body.action === "retry") {
    const current = await getJob(access, id);
    if (!current || !["failed", "partial", "cancelled"].includes(current.state)) return Response.json({ error: "当前任务不可重试" }, { status: 409 });
    if (!["schedule-import", "question-import"].includes(current.type)) return Response.json({ error: "该任务需要回到原功能重新生成，以重新校验最新业务证据" }, { status: 409 });
    const job = await updateJob(access, id, { state: "queued", stage: "retry_queued", progress: current.progress, error: {}, message: "已加入重试队列" });
    if (job && ["schedule-import", "question-import"].includes(job.type)) deferV2BackgroundJob(id);
    await audit(access, "retry", "v2_job", id);
    return Response.json({ job });
  }
  return Response.json({ error: "不支持的任务操作" }, { status: 400 });
}
