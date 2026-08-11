import { miniDenied, requireMini } from "../../../../lib/mini-auth";
import { listAssignments } from "../../../../lib/services/assignment-service";

export async function GET(request: Request) {
  const access = await requireMini(request);
  if (miniDenied(access)) return access;
  const filters = new URL(request.url).searchParams;
  filters.set("kind", "dictation");
  const result = await listAssignments({ kind: "mini", access }, filters);
  return Response.json({ ...result, assignments: result.assignments.map((item) => {
    const contentItems = Array.isArray(item.contentItems) ? item.contentItems : [];
    return { ...item, itemCount: contentItems.length, contentItems: item.kind === "follow_reading" ? contentItems : [] };
  }) });
}
