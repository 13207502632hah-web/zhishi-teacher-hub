import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { saveReview } from "../../../lib/services/review-service";
import { listSubmissions, submitAssignment } from "../../../lib/services/submission-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const assignmentId = Number(new URL(request.url).searchParams.get("assignmentId") || 0);
  return Response.json({ submissions: await listSubmissions(access, assignmentId) });
}

export async function POST(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const body = await request.json() as Record<string, any>;
  if (body.action === "save-review" || body.action === "confirm-review") {
    if (access.role !== "teacher" || !access.userId) return Response.json({ error: "教师账号尚未关联网站用户，不能确认批改" }, { status: 403 });
    return saveReview(body, { actor: { type: "mini_account", id: access.accountId }, userId: access.userId });
  }
  return submitAssignment(access, body);
}
