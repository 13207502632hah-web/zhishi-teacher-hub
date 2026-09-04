import { waitUntil } from "cloudflare:workers";
import { getBackgroundAccess } from "../access";
import { processScheduleImportJobV2 } from "./schedule-import-service";
import { processQuestionImportJobV2 } from "./question-import-service";
import { claimBackgroundJob, listClaimableBackgroundJobIds, requeueBackgroundJob } from "./job-service";

const supportedTypes = new Set(["schedule-import", "schedule-confirm", "question-import"]);

export async function runV2BackgroundJob(jobId: string) {
  const leaseOwner = `worker:${crypto.randomUUID()}`;
  const claim = await claimBackgroundJob(jobId, leaseOwner, 300);
  if (!claim) return { claimed: false };
  if (!supportedTypes.has(claim.type)) {
    await requeueBackgroundJob(jobId, `后台消费者尚未注册任务类型：${claim.type}`, leaseOwner);
    return { claimed: true, supported: false };
  }
  const access = await getBackgroundAccess(claim.userId);
  if (!access) {
    await requeueBackgroundJob(jobId, "任务创建者已停用或角色已失效", leaseOwner);
    return { claimed: true, access: false };
  }
  try {
    const outcome = claim.type === "schedule-import" || claim.type === "schedule-confirm"
      ? await processScheduleImportJobV2(access, claim.id, leaseOwner)
      : await processQuestionImportJobV2(access, claim.id);
    if (outcome && typeof outcome === "object" && "requeue" in outcome && outcome.requeue === true) deferV2BackgroundJob(jobId);
    return { claimed: true, completed: true, requeued: Boolean(outcome && typeof outcome === "object" && "requeue" in outcome && outcome.requeue === true) };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "后台任务执行失败";
    return { claimed: true, completed: false, ...(await requeueBackgroundJob(jobId, message, leaseOwner)) };
  }
}

export function deferV2BackgroundJob(jobId: string) {
  waitUntil(runV2BackgroundJob(jobId));
}

export async function drainV2BackgroundJobs(limit = 8) {
  const ids = await listClaimableBackgroundJobIds(limit);
  const results = [];
  for (let index = 0; index < ids.length; index += 2) results.push(...await Promise.all(ids.slice(index, index + 2).map(runV2BackgroundJob)));
  return { claimed: results.filter((item) => item.claimed).length, results };
}
