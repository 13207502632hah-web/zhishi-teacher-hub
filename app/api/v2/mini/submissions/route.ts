import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { listSubmissions, submitAssignment } from "../../../../lib/services/submission-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const assignmentId = Number(new URL(request.url).searchParams.get("assignmentId") || 0);
  return Response.json({ submissions: await listSubmissions(access, assignmentId) });
}

export async function POST(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const body = await request.json() as Record<string, any>;
  return submitAssignment(access, body);
}
