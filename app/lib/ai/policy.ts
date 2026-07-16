export const SAFE_QUESTION_FIELDS = ["questionType", "stage", "grade", "textbookVersion", "volume", "unit", "topic", "knowledgePoints", "coreCompetencies", "abilityLevel"] as const;
export const SENSITIVE_QUESTION_FIELDS = ["answer", "analysis", "factBasis", "textbookView", "valueJudgment", "answerLogic", "standardExpression"] as const;

const FORBIDDEN_AI_KEYS = /(?:guardian|contact|phone|mobile|wechat|open.?id|token|session|password|secret|attachment|file|storage.?key|cookie|login|credential)/i;

export class AiPayloadError extends Error {
  constructor(message: string, public code: string, public status = 502) { super(message); }
}

export function normalizeOptionalJsonObject(value: unknown) {
  if (value == null) return {} as Record<string, unknown>;
  if (typeof value !== "object" || Array.isArray(value)) throw new AiPayloadError("DeepSeek 审核分组必须是 JSON 对象", "SCHEMA_INVALID");
  return value as Record<string, unknown>;
}

export function redactPrivateText(value: unknown, names: string[] = []) {
  let text = String(value || "");
  for (const name of names.filter(Boolean)) text = text.replaceAll(name, "【学生】");
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "【邮箱已隐藏】")
    .replace(/(?<!\d)1[3-9]\d(?:[\s-]?\d){8}(?!\d)/g, "【手机号已隐藏】")
    .replace(/(?<!\d)0\d{2,3}[\s-]?\d{7,8}(?!\d)/g, "【电话已隐藏】")
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, "【证件号已隐藏】")
    .replace(/(?:微信号|微信|WeChat|open.?id)\s*[:：=]?\s*[A-Za-z][-_A-Za-z0-9]{5,31}/gi, "【微信标识已隐藏】")
    .replace(/\bwxid_[A-Za-z0-9_-]+\b/gi, "【微信标识已隐藏】")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "【登录数据已隐藏】")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "【登录数据已隐藏】")
    .replace(/(?:token|session|cookie|password|secret)\s*[:：=]\s*[^\s,，;；]+/gi, "【登录数据已隐藏】")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "【附件已隐藏】")
    .replace(/\b(?:data|blob):[^\s\"'<>]+/gi, "【附件数据已隐藏】")
    .replace(/https?:\/\/\S+/gi, "【外部地址已隐藏】")
    .replace(/(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)\.(?:docx?|pdf|xlsx?|pptx?|zip|png|jpe?g|heic)\b/gi, "【附件地址已隐藏】");
}

export function sanitizeForAi(value: unknown, names: string[] = []): unknown {
  if (typeof value === "string") return redactPrivateText(value, names);
  if (Array.isArray(value)) return value.map((item) => sanitizeForAi(item, names));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !FORBIDDEN_AI_KEYS.test(key))
    .map(([key, item]) => [key, sanitizeForAi(item, names)]));
}

export function dailyLimitReached(calls: number, limit: number) {
  return Number(calls || 0) >= Math.max(1, Number(limit || 50));
}

export function shouldRetryDeepSeek(attempt: number, status?: number, networkFailure = false) {
  return attempt === 0 && (networkFailure || status === 429 || Number(status || 0) >= 500);
}

export function deepSeekHttpFailure(status: number) {
  if (status === 401) return { status: 503, code: "HTTP_401", message: "DeepSeek 密钥无效或已失效" };
  if (status === 402) return { status: 502, code: "HTTP_402", message: "DeepSeek 账户余额不足" };
  if (status === 429) return { status: 502, code: "HTTP_429", message: "DeepSeek 请求过于频繁" };
  return { status: 502, code: `HTTP_${status}`, message: "DeepSeek 请求失败" };
}

export function buildDeepSeekRequest({ model, system, payload, thinking, maxTokens }: { model: string; system: string; payload: unknown; thinking: boolean; maxTokens: number }) {
  const safePayload = sanitizeForAi(payload);
  return {
    safePayload,
    body: {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(safePayload) }],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      temperature: 0.2,
      thinking: thinking ? { type: "enabled" } : { type: "disabled" },
    },
  };
}

export function parseDeepSeekEnvelope(result: unknown) {
  const row = result as Record<string, any>;
  const choice = row?.choices?.[0], content = choice?.message?.content;
  if (choice?.finish_reason === "length") throw new AiPayloadError("DeepSeek 输出被截断，结果未保存", "TRUNCATED_RESPONSE");
  if (choice?.finish_reason !== "stop") throw new AiPayloadError("DeepSeek 未完整结束输出，结果未保存", `FINISH_${String(choice?.finish_reason || "MISSING").toUpperCase()}`);
  if (typeof content !== "string" || !content.trim()) throw new AiPayloadError("DeepSeek 未返回可用内容", "EMPTY_RESPONSE");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new AiPayloadError("DeepSeek 返回格式不符合结构化要求", "INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.keys(parsed as Record<string, unknown>).length) throw new AiPayloadError("DeepSeek 返回了空 JSON，结果未保存", "EMPTY_JSON");
  return { parsed, usage: (row.usage || {}) as Record<string, number> };
}

export async function executeDeepSeekRequest({ url, apiKey, body, fetcher = fetch, timeoutMs = 60_000 }: { url: string; apiKey: string; body: unknown; fetcher?: typeof fetch; timeoutMs?: number }) {
  let lastError: AiPayloadError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
      if (!response.ok) {
        const failure = deepSeekHttpFailure(response.status);
        if (shouldRetryDeepSeek(attempt, response.status)) { lastError = new AiPayloadError("DeepSeek 暂时繁忙，已自动重试", failure.code, failure.status); continue; }
        throw new AiPayloadError(failure.message, failure.code, failure.status);
      }
      let result: unknown;
      try { result = await response.json(); } catch { throw new AiPayloadError("DeepSeek 响应不是有效 JSON，结果未保存", "INVALID_PROVIDER_RESPONSE"); }
      return parseDeepSeekEnvelope(result);
    } catch (error) {
      if (error instanceof AiPayloadError) throw error;
      lastError = new AiPayloadError("DeepSeek 网络请求超时或中断", "NETWORK_ERROR");
      if (shouldRetryDeepSeek(attempt, undefined, true)) continue;
      throw lastError;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new AiPayloadError("DeepSeek 网络请求超时或中断", "NETWORK_ERROR");
}

export function aiRoleAllowed(role: string) { return role === "teacher"; }
