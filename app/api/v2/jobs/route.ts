import { isDenied, requirePermission } from "../../../lib/access";
import { listJobs } from "../../../lib/v2/job-service";

export async function GET(request: Request) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams;
  const jobs = await listJobs(access, { type: params.get("type") || undefined, state: params.get("state") || undefined, limit: Number(params.get("limit") || 30) });
  return Response.json({ jobs }, { headers: { "Cache-Control": "private, no-store" } });
}
