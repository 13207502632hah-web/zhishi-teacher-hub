import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { createAssignment, listAssignments } from "../../../lib/services/assignment-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  return Response.json(await listAssignments({ kind: "mini", access }, new URL(request.url).searchParams));
}

export async function POST(request: Request) {
  const access = await requireMini(request, ["teacher"]); if (miniDenied(access)) return access;
  return createAssignment({ kind: "mini", access }, await request.json());
}
