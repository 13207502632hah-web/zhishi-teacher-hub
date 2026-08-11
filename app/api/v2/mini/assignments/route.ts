import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { listAssignments } from "../../../../lib/services/assignment-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const filters = new URL(request.url).searchParams;
  filters.set("kind", "homework");
  return Response.json(await listAssignments({ kind: "mini", access }, filters));
}
