import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";

export const SAFE_QUESTION_FIELDS = ["questionType", "stage", "grade", "textbookVersion", "volume", "unit", "topic", "knowledgePoints", "coreCompetencies", "abilityLevel"] as const;
export const SENSITIVE_QUESTION_FIELDS = ["answer", "analysis", "factBasis", "textbookView", "valueJudgment", "answerLogic", "standardExpression"] as const;

type AiFeature = "feedback_draft" | "question_review";
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };

export class AiServiceError extends Error {
  constructor(message: string, public status = 500, public code = "AI_ERROR") { super(message); }
}

export function requireAiTeacher(access: AccessContext) {
  if (access.role !== "teacher") return Response.json({ error: "DeepSeek 辅助仅限教师管理员使用" }, { status: 403 });
  return null;
}

export async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function redactPrivateText(value: unknown, names: string[] = []) {
  let text = String(value || "");
  for (const name of names.filter(Boolean)) text = text.replaceAll(name, "【学生】");
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "【邮箱已隐藏】")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "【手机号已隐藏】")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "【证件号已隐藏】");
}

async function readiness(access: AccessContext) {
  await env.DB.prepare("INSERT OR IGNORE INTO ai_settings(user_id) VALUES(?)").bind(access.id).run();
  const setting = await env.DB.prepare("SELECT enabled,privacy_ack_at AS privacyAckAt,daily_limit AS dailyLimit,emergency_disabled AS emergencyDisabled,fast_model AS fastModel,deep_model AS deepModel FROM ai_settings WHERE user_id=?").bind(access.id).first<Record<string, any>>();
  if (env.DEEPSEEK_AI_ENABLED !== "true" || !env.DEEPSEEK_API_KEY) throw new AiServiceError("DeepSeek 尚未在服务器安全配置中启用", 503, "AI_NOT_CONFIGURED");
  if (!setting?.enabled || setting?.emergencyDisabled) throw new AiServiceError("DeepSeek 辅助当前已关闭", 409, "AI_DISABLED");
  if (!setting?.privacyAckAt) throw new AiServiceError("首次使用前请在设置页确认隐私说明", 409, "PRIVACY_ACK_REQUIRED");
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM ai_runs WHERE user_id=? AND date(created_at)=date('now')").bind(access.id).first<{ count: number }>();
  if (Number(count?.count || 0) >= Number(setting.dailyLimit || 50)) throw new AiServiceError("今日 AI 调用已达到教师设置的上限", 429, "DAILY_LIMIT");
  return setting;
}

function estimatedCost(model: string, usage: Usage) {
  const pro = model.includes("pro"), hit = Number(usage.prompt_cache_hit_tokens || 0), miss = Number(usage.prompt_cache_miss_tokens ?? usage.prompt_tokens ?? 0), output = Number(usage.completion_tokens || 0);
  const rates = pro ? { hit: 0.003625, miss: 0.435, output: 0.87 } : { hit: 0.0028, miss: 0.14, output: 0.28 };
  return (hit * rates.hit + miss * rates.miss + output * rates.output) / 1_000_000;
}

export async function callDeepSeekJson<T>({ access, feature, entityType, entityId, system, payload, deep = false, maxTokens = 2400 }: { access: AccessContext; feature: AiFeature; entityType: string; entityId?: string | number; system: string; payload: unknown; deep?: boolean; maxTokens?: number }): Promise<{ data: T; runId: number }> {
  const setting = await readiness(access), model = String(deep ? setting.deepModel : setting.fastModel), inputFingerprint = await fingerprint(payload);
  const created = await env.DB.prepare("INSERT INTO ai_runs(user_id,feature,entity_type,entity_id,model,prompt_version,input_fingerprint,status) VALUES(?,?,?,?,?,?,?,'running') RETURNING id").bind(access.id, feature, entityType, entityId == null ? null : String(entityId), model, "2026-07-15.1", inputFingerprint).first<{ id: number }>();
  if (!created) throw new AiServiceError("无法建立 AI 调用记录", 500, "RUN_LOG_FAILED");
  const url = `${String(env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }, body: JSON.stringify({ model, user_id: `teacher_${access.id}`, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }], response_format: { type: "json_object" }, max_tokens: maxTokens, temperature: 0.2, thinking: deep ? { type: "enabled" } : { type: "disabled" } }) });
      clearTimeout(timer);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt === 0) { lastError = new AiServiceError("DeepSeek 暂时繁忙，已自动重试", 502, `HTTP_${response.status}`); continue; }
        throw new AiServiceError(response.status === 401 ? "DeepSeek 密钥无效或已失效" : response.status === 402 ? "DeepSeek 账户余额不足" : "DeepSeek 请求失败", response.status === 401 ? 503 : 502, `HTTP_${response.status}`);
      }
      const result = await response.json() as Record<string, any>, content = result.choices?.[0]?.message?.content;
      if (!content) throw new AiServiceError("DeepSeek 未返回可用内容", 502, "EMPTY_RESPONSE");
      let data: T;
      try { data = JSON.parse(content) as T; } catch { throw new AiServiceError("DeepSeek 返回格式不符合结构化要求", 502, "INVALID_JSON"); }
      const usage = (result.usage || {}) as Usage;
      await env.DB.prepare("UPDATE ai_runs SET status='completed',prompt_tokens=?,cache_hit_tokens=?,cache_miss_tokens=?,completion_tokens=?,total_tokens=?,estimated_cost_usd=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(usage.prompt_tokens || 0), Number(usage.prompt_cache_hit_tokens || 0), Number(usage.prompt_cache_miss_tokens || 0), Number(usage.completion_tokens || 0), Number(usage.total_tokens || 0), estimatedCost(model, usage), created.id).run();
      return { data, runId: created.id };
    } catch (error) {
      clearTimeout(timer); lastError = error;
      if (attempt === 0 && !(error instanceof AiServiceError)) continue;
      break;
    }
  }
  const error = lastError instanceof AiServiceError ? lastError : new AiServiceError("DeepSeek 网络请求超时或中断", 502, "NETWORK_ERROR");
  await env.DB.prepare("UPDATE ai_runs SET status='failed',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(error.code, created.id).run();
  throw error;
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiServiceError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: "AI 辅助暂时不可用，请稍后重试" }, { status: 500 });
}
