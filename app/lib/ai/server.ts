import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { aiRoleAllowed, AiPayloadError, buildDeepSeekRequest, executeDeepSeekRequest } from "./policy";

export { normalizeOptionalJsonObject, redactPrivateText, SAFE_QUESTION_FIELDS, sanitizeForAi, SENSITIVE_QUESTION_FIELDS } from "./policy";

type AiFeature = "feedback_draft" | "question_review" | "lesson_prep" | "paper_review" | "reflection_draft";
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };

export class AiServiceError extends Error {
  constructor(message: string, public status = 500, public code = "AI_ERROR") { super(message); }
}

export function requireAiTeacher(access: AccessContext) {
  if (!aiRoleAllowed(access.role)) return Response.json({ error: "DeepSeek 辅助仅限教师管理员使用" }, { status: 403 });
  return null;
}

export async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function readiness(access: AccessContext) {
  await env.DB.prepare("INSERT OR IGNORE INTO ai_settings(user_id) VALUES(?)").bind(access.id).run();
  const setting = await env.DB.prepare("SELECT enabled,privacy_ack_at AS privacyAckAt,daily_limit AS dailyLimit,emergency_disabled AS emergencyDisabled,fast_model AS fastModel,deep_model AS deepModel FROM ai_settings WHERE user_id=?").bind(access.id).first<Record<string, any>>();
  if (env.DEEPSEEK_AI_ENABLED !== "true" || !env.DEEPSEEK_API_KEY) throw new AiServiceError("DeepSeek 尚未在服务器安全配置中启用", 503, "AI_NOT_CONFIGURED");
  if (!setting?.enabled || setting?.emergencyDisabled) throw new AiServiceError("DeepSeek 辅助当前已关闭", 409, "AI_DISABLED");
  if (!setting?.privacyAckAt) throw new AiServiceError("首次使用前请在设置页确认隐私说明", 409, "PRIVACY_ACK_REQUIRED");
  return setting;
}

function estimatedCost(model: string, usage: Usage) {
  const pro = model.includes("pro"), hit = Number(usage.prompt_cache_hit_tokens || 0), miss = Number(usage.prompt_cache_miss_tokens ?? usage.prompt_tokens ?? 0), output = Number(usage.completion_tokens || 0);
  const rates = pro ? { hit: 0.003625, miss: 0.435, output: 0.87 } : { hit: 0.0028, miss: 0.14, output: 0.28 };
  return (hit * rates.hit + miss * rates.miss + output * rates.output) / 1_000_000;
}

export async function callDeepSeekJson<T>({ access, feature, entityType, entityId, system, payload, thinking = false, useProModel = false, maxTokens = 2400, validate }: { access: AccessContext; feature: AiFeature; entityType: string; entityId?: string | number; system: string; payload: unknown; thinking?: boolean; useProModel?: boolean; maxTokens?: number; validate?: (value: unknown) => T }): Promise<{ data: T; runId: number; model: string }> {
  const setting = await readiness(access), model = String(useProModel ? setting.deepModel : setting.fastModel), request = buildDeepSeekRequest({ model, system, payload, thinking, maxTokens }), inputFingerprint = await fingerprint(request.safePayload);
  const dailyLimit = Math.max(1, Number(setting.dailyLimit || 50));
  const created = await env.DB.prepare("INSERT INTO ai_runs(user_id,feature,entity_type,entity_id,model,prompt_version,input_fingerprint,status) SELECT ?,?,?,?,?,?,?,'running' WHERE (SELECT COUNT(*) FROM ai_runs WHERE user_id=? AND date(datetime(created_at,'+8 hours'))=date(datetime('now','+8 hours')))<? RETURNING id").bind(access.id, feature, entityType, entityId == null ? null : String(entityId), model, "2026-07-16.1", inputFingerprint, access.id, dailyLimit).first<{ id: number }>();
  if (!created) throw new AiServiceError("今日 AI 调用已达到教师设置的上限", 429, "DAILY_LIMIT");
  const url = `${String(env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
  try {
    const { parsed, usage } = await executeDeepSeekRequest({ url, apiKey: String(env.DEEPSEEK_API_KEY), body: request.body });
    let data: T;
    try { data = validate ? validate(parsed) : parsed as T; } catch (error) { throw error instanceof AiServiceError ? error : new AiServiceError("DeepSeek 字段校验失败，结果未保存", 502, "SCHEMA_INVALID"); }
    await env.DB.prepare("UPDATE ai_runs SET status='completed',prompt_tokens=?,cache_hit_tokens=?,cache_miss_tokens=?,completion_tokens=?,total_tokens=?,estimated_cost_usd=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(usage.prompt_tokens || 0), Number(usage.prompt_cache_hit_tokens || 0), Number(usage.prompt_cache_miss_tokens || 0), Number(usage.completion_tokens || 0), Number(usage.total_tokens || 0), estimatedCost(model, usage), created.id).run();
    return { data, runId: created.id, model };
  } catch (reason) {
    const error = reason instanceof AiServiceError ? reason : reason instanceof AiPayloadError ? new AiServiceError(reason.message, reason.status, reason.code) : new AiServiceError("DeepSeek 网络请求超时或中断", 502, "NETWORK_ERROR");
    await env.DB.prepare("UPDATE ai_runs SET status='failed',error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error.code, error.message.slice(0, 500), created.id).run();
    throw error;
  }
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiServiceError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: "AI 辅助暂时不可用，请稍后重试" }, { status: 500 });
}
