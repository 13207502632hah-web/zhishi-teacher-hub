import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { requireAiTeacher } from "../../../lib/ai/server";
import { loadAiUsage } from "../../../lib/ai/usage";

async function load(userId: number) {
  await env.DB.prepare("INSERT OR IGNORE INTO ai_settings(user_id) VALUES(?)").bind(userId).run();
  const settings = await env.DB.prepare("SELECT enabled,include_student_name AS includeStudentName,privacy_ack_at AS privacyAckAt,daily_limit AS dailyLimit,emergency_disabled AS emergencyDisabled,fast_model AS fastModel,deep_model AS deepModel FROM ai_settings WHERE user_id=?").bind(userId).first();
  const learning = await env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(active),0) AS activeCount FROM ai_feedback_learning_events WHERE user_id=?").bind(userId).first();
  const learningRecords = await env.DB.prepare("SELECT id,feedback_id AS feedbackId,audience,tone,stage,grade,active,created_at AS createdAt FROM ai_feedback_learning_events WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").bind(userId).all();
  const usage = await loadAiUsage(userId);
  return { settings, usage: usage.month, usageDetail: usage, learning, learningRecords: learningRecords.results, serverConfigured: env.DEEPSEEK_AI_ENABLED === "true" && Boolean(env.DEEPSEEK_API_KEY) };
}

export async function GET() { const access = await requirePermission("settings:read"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied; return Response.json(await load(access.id)); }

export async function PATCH(request: Request) {
  const access = await requirePermission("settings:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  const body = await request.json() as Record<string, any>;
  if (body.action === "clearLearning") { await env.DB.prepare("DELETE FROM ai_feedback_learning_events WHERE user_id=?").bind(access.id).run(); await audit(access, "delete_all", "ai_feedback_learning"); return Response.json(await load(access.id)); }
  if (body.action === "setLearningActive") { const id = Number(body.id), active = body.active ? 1 : 0; const owned = await env.DB.prepare("SELECT 1 AS owned FROM ai_feedback_learning_events WHERE id=? AND user_id=?").bind(id, access.id).first(); if (!owned) return Response.json({ error: "学习记录不存在或无权修改" }, { status: 404 }); await env.DB.prepare("UPDATE ai_feedback_learning_events SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(active, id, access.id).run(); await audit(access, active ? "enable" : "disable", "ai_feedback_learning", id); return Response.json(await load(access.id)); }
  const enabled = body.enabled ? 1 : 0, includeName = body.includeStudentName === false ? 0 : 1, limit = Math.min(200, Math.max(1, Number(body.dailyLimit || 50))), emergency = body.emergencyDisabled ? 1 : 0, privacyAck = body.privacyAcknowledged ? new Date().toISOString() : null;
  await env.DB.prepare("INSERT INTO ai_settings(user_id,enabled,include_student_name,privacy_ack_at,daily_limit,emergency_disabled,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,include_student_name=excluded.include_student_name,privacy_ack_at=COALESCE(ai_settings.privacy_ack_at,excluded.privacy_ack_at),daily_limit=excluded.daily_limit,emergency_disabled=excluded.emergency_disabled,updated_at=CURRENT_TIMESTAMP").bind(access.id, enabled, includeName, privacyAck, limit, emergency).run();
  await audit(access, "update", "ai_settings", access.id, { enabled: Boolean(enabled), includeStudentName: Boolean(includeName), dailyLimit: limit, emergencyDisabled: Boolean(emergency) });
  return Response.json(await load(access.id));
}
