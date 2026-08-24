import { audit, isDenied, requirePermission } from "../../../lib/access";
import { createApproval, listApprovals } from "../../../lib/v2/approval-service";
import { listJobs } from "../../../lib/v2/job-service";

export async function GET(request: Request) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, state = params.get("state") || "pending";
  const [approvals, recentJobs] = await Promise.all([
    listApprovals(access, state, Number(params.get("limit") || 50)),
    listJobs(access, { limit: 30 }),
  ]);
  const activeJobs = recentJobs.filter((job) => ["queued", "running", "waiting_review", "partial", "failed", "cancelled"].includes(job.state)).slice(0, 12);
  return Response.json({ approvals, activeJobs, canDecide: access.role === "teacher" }, { headers: { "Cache-Control": "private, no-store" } });
}

const allowedActions = new Set(["question.promote", "question.update", "question.delete", "schedule.adjust", "assignment.publish", "class_file.publish", "class_notice.publish", "submission.review_confirm", "assessment.complete", "recognition.confirm", "academic_year.promote", "academic_year.undo", "feedback_import.confirm", "feedback.send", "finance.confirm", "finance.receive", "paper.create_draft", "lesson.prepare_draft", "analysis.create_report", "mobile_record.share", "resource.publish"]);

export async function POST(request: Request) {
  const access = await requirePermission("dashboard:read"); if (isDenied(access)) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>, actionType = String(body.actionType || "");
  if (!allowedActions.has(actionType)) return Response.json({ error: "不支持的待确认动作" }, { status: 400 });
  const title = String(body.title || "").trim().slice(0, 200), summary = String(body.summary || "").trim().slice(0, 5000);
  if (!title || !summary) return Response.json({ error: "标题和建议摘要不能为空" }, { status: 400 });
  const approval = await createApproval(access, { actionType, entityType: String(body.entityType || "suggestion").slice(0, 80), entityId: body.entityId == null ? undefined : String(body.entityId), title, summary, payload: body.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : {}, evidence: Array.isArray(body.evidence) ? body.evidence : [], confidence: body.confidence == null ? undefined : Number(body.confidence) });
  await audit(access, "approval_created", "v2_approval", approval?.id || null, { actionType });
  return Response.json({ approval }, { status: 201 });
}
