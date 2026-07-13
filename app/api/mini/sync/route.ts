import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { listAssignments } from "../../../lib/services/assignment-service";
import { miniAccountState } from "../../../lib/services/mini-binding-service";
import { syncEventsFor } from "../../../lib/services/mini-sync-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const params = new URL(request.url).searchParams, cursor = Math.max(0, Number(params.get("cursor") || 0));
  const changes = await syncEventsFor(access, cursor);
  if (cursor > 0) return Response.json(changes);
  const [assignments, me] = await Promise.all([listAssignments({ kind: "mini", access }, new URLSearchParams()), miniAccountState(access, access.expiresAt)]);
  return Response.json({ ...changes, full: true, snapshot: { assignments: assignments.assignments, counts: assignments.counts, me } });
}
