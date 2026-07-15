import { isDenied, requirePermission } from "../../../lib/access";
import { requireAiTeacher } from "../../../lib/ai/server";
import { loadAiUsage } from "../../../lib/ai/usage";

export async function GET() {
  const access = await requirePermission("settings:read"); if (isDenied(access)) return access;
  const denied = requireAiTeacher(access); if (denied) return denied;
  return Response.json(await loadAiUsage(access.id), { headers: { "Cache-Control": "no-store" } });
}
