import { env } from "cloudflare:workers";
import { audit, isDenied, requireFeedbackAccess, requirePermission } from "../../../../lib/access";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), denied = await requireFeedbackAccess(access, id); if (denied) return denied;
  const result = await env.DB.prepare("UPDATE feedback SET copied_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('confirmed','copied','sent')").bind(id).run();
  if (!Number(result.meta?.changes || 0)) return Response.json({ error: "请先确认反馈内容" }, { status: 409 });
  await audit(access, "copy", "feedback", id);
  return Response.json({ ok: true });
}
