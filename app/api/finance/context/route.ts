import { env } from "cloudflare:workers";
import { isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";
import { resolvePricingContext } from "../../../lib/finance-rules";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, lessonId = Number(params.get("lessonId") || 0); if (!lessonId) return Response.json({ error: "请选择课时" }, { status: 400 });
  const denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const payerType = params.get("payerType") === "parent" ? "parent" : "institution", payerId = Number(params.get("payerId") || 0) || null, [context, institutions] = await Promise.all([resolvePricingContext(lessonId, payerType, payerId), env.DB.prepare("SELECT id,name,settlement_cycle AS settlementCycle FROM institutions WHERE status='active' ORDER BY name").all()]);
  if (!context) return Response.json({ error: "课时不存在" }, { status: 404 });
  return Response.json({ ...context, institutions: institutions.results });
}
