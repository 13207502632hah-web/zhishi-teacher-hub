import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { anonymizeForAi, safeInputSummary } from "./privacy";

export type AiCapability = "fast" | "reasoning" | "vision" | "embedding" | "rerank";
export type AiEvidence = { label: string; value: string };

type AiRoute = { provider: string; baseUrl: string; apiKey: string; model: string };
type AiCallInput<T> = {
  access: AccessContext;
  capability: Exclude<AiCapability, "embedding">;
  system: string;
  payload: unknown;
  promptVersion: string;
  jobId?: string;
  evidence?: AiEvidence[];
  images?: string[];
  knownNames?: string[];
  maxTokens?: number;
  validate: (value: unknown) => T;
};

export class V2AiError extends Error {
  constructor(message: string, public code: string, public status = 502) { super(message); }
}

export const v2RuntimeValue = (key: keyof typeof env) => {
  const workerValue = env[key];
  if (typeof workerValue === "string" && workerValue.trim()) return workerValue.trim();
  const processValue = typeof process !== "undefined" ? process.env[String(key)] : undefined;
  return processValue?.trim() || "";
};

const chatEndpoint = (base: string) => {
  const normalized = base.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
};

function routesFor(capability: Exclude<AiCapability, "embedding">): AiRoute[] {
  const routes: AiRoute[] = [];
  const openCodeKey = v2RuntimeValue("OPENAI_API_KEY"), openCodeBase = v2RuntimeValue("OPENAI_BASE_URL") || "https://opencode.ai/zen/go/v1";
  if (openCodeKey) {
    const preferred = capability === "fast" ? v2RuntimeValue("OPENAI_FAST_MODEL") || "deepseek-v4-flash"
      : capability === "vision" ? v2RuntimeValue("OPENAI_VISION_MODEL") || "mimo-v2-omni"
      : v2RuntimeValue("OPENAI_REASONING_MODEL") || "gpt-5.6-luna";
    routes.push({ provider: "opencode-zen", baseUrl: openCodeBase, apiKey: openCodeKey, model: preferred });
    if (preferred !== "deepseek-v4-pro" && capability !== "vision") routes.push({ provider: "opencode-zen", baseUrl: openCodeBase, apiKey: openCodeKey, model: "deepseek-v4-pro" });
  }
  const deepSeekKey = v2RuntimeValue("DEEPSEEK_API_KEY");
  if (deepSeekKey && v2RuntimeValue("DEEPSEEK_AI_ENABLED") === "true" && capability !== "vision") {
    routes.push({ provider: "deepseek", baseUrl: v2RuntimeValue("DEEPSEEK_API_BASE") || "https://api.deepseek.com", apiKey: deepSeekKey, model: capability === "fast" ? "deepseek-chat" : "deepseek-reasoner" });
  }
  return routes;
}

const encoder = new TextEncoder();
const fingerprint = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const extractJson = (content: unknown) => {
  if (content && typeof content === "object") return content;
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((value) => value >= 0));
  const candidate = Number.isFinite(start) ? text.slice(start) : text;
  try { return JSON.parse(candidate); } catch { throw new V2AiError("AI 返回内容不是有效 JSON，未进入业务流程", "SCHEMA_INVALID"); }
};

export async function callV2AiJson<T>(input: AiCallInput<T>) {
  const routes = routesFor(input.capability);
  if (!routes.length || (v2RuntimeValue("AI_V2_ENABLED") && v2RuntimeValue("AI_V2_ENABLED") !== "true")) throw new V2AiError("V2 智能服务尚未启用", "AI_NOT_CONFIGURED", 503);
  const anonymized = anonymizeForAi(input.payload, input.knownNames);
  const requestFingerprint = await fingerprint({ capability: input.capability, payload: anonymized.value, promptVersion: input.promptVersion });
  const errors: string[] = [];

  for (const [routeIndex, route] of routes.entries()) {
    const runId = crypto.randomUUID();
    const insert = routeIndex === 0
      ? env.DB.prepare("INSERT INTO v2_ai_runs(id,user_id,job_id,capability,provider,model,prompt_version,input_fingerprint,input_summary,evidence_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM v2_ai_runs WHERE user_id=? AND created_at>=datetime('now','-60 seconds'))<30 RETURNING id").bind(runId, input.access.id, input.jobId || null, input.capability, route.provider, route.model, input.promptVersion, requestFingerprint, safeInputSummary(anonymized.value), JSON.stringify(input.evidence || []), input.access.id)
      : env.DB.prepare("INSERT INTO v2_ai_runs(id,user_id,job_id,capability,provider,model,prompt_version,input_fingerprint,input_summary,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(runId, input.access.id, input.jobId || null, input.capability, route.provider, route.model, input.promptVersion, requestFingerprint, safeInputSummary(anonymized.value), JSON.stringify(input.evidence || []));
    const created = await insert.first<{ id: string }>();
    if (!created) throw new V2AiError("短时间请求过多，系统已阻止可能的重复循环，请稍后再试", "AI_BURST_GUARD", 429);
    try {
      const userContent: unknown = input.images?.length
        ? [{ type: "text", text: JSON.stringify(anonymized.value) }, ...input.images.map((url) => ({ type: "image_url", image_url: { url } }))]
        : JSON.stringify(anonymized.value);
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), input.capability === "vision" ? 90_000 : 60_000);
      let response: Response;
      try {
        response = await fetch(chatEndpoint(route.baseUrl), {
          method: "POST", signal: controller.signal,
          headers: { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: route.model, temperature: input.capability === "fast" ? 0.25 : 0.1, max_tokens: input.maxTokens || 8000, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${input.system}\n只输出一个 JSON 对象；所有结论必须给出依据，不得声称已经执行正式业务动作。` }, { role: "user", content: userContent }] }),
        });
      } finally { clearTimeout(timeout); }
      if (!response.ok) throw new V2AiError(`模型服务返回 ${response.status}`, `HTTP_${response.status}`, response.status === 429 ? 429 : 502);
      const envelope = await response.json() as Record<string, any>;
      const parsed = extractJson(envelope.choices?.[0]?.message?.content ?? envelope.output_text ?? envelope.output);
      const data = input.validate(parsed);
      const usage = envelope.usage || {};
      await env.DB.prepare("UPDATE v2_ai_runs SET status='completed',prompt_tokens=?,completion_tokens=?,total_tokens=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(Number(usage.prompt_tokens || usage.input_tokens || 0), Number(usage.completion_tokens || usage.output_tokens || 0), Number(usage.total_tokens || 0), runId).run();
      return { data, runId, model: route.model, provider: route.provider, privacy: anonymized.report };
    } catch (reason) {
      const error = reason instanceof V2AiError ? reason : new V2AiError(reason instanceof Error ? reason.message : "模型请求失败", "NETWORK_ERROR");
      errors.push(`${route.model}:${error.code}`);
      await env.DB.prepare("UPDATE v2_ai_runs SET status='failed',error_code=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(error.code, error.message.slice(0, 500), runId).run();
    }
  }
  throw new V2AiError(`所有可用模型均未返回合格结果（${errors.join("、")}）`, "ALL_MODELS_FAILED");
}

export async function createV2Embedding(text: string) {
  const model = v2RuntimeValue("OPENAI_EMBEDDING_MODEL"), key = v2RuntimeValue("OPENAI_API_KEY"), base = v2RuntimeValue("OPENAI_BASE_URL");
  if (model && key && base) {
    const endpoint = `${base.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "")}/embeddings`;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: text.slice(0, 24_000) }) });
      if (response.ok) {
        const result = await response.json() as Record<string, any>, vector = result.data?.[0]?.embedding;
        if (Array.isArray(vector) && vector.every((value) => Number.isFinite(Number(value)))) return { model, vector: vector.map(Number), fallback: false };
      }
    } catch { /* 使用确定性语义签名，检索响应会明确 coverage。 */ }
  }
  return { model: "local-char-ngram-v1", vector: localSemanticVector(text), fallback: true };
}

export async function queryV2VectorIndex(vector: number[], limit = 200, filters: Record<string, unknown> = {}) {
  const url = v2RuntimeValue("VECTOR_SEARCH_URL"); if (!url || !vector.length) return { available: false, matches: [] as Array<{ id: number; score: number }> };
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const key = v2RuntimeValue("VECTOR_SEARCH_API_KEY"), response = await fetch(url, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ namespace: "questions-v2", vector, limit: Math.min(1000, Math.max(1, limit)), filters }) });
    if (!response.ok) throw new Error(`vector index ${response.status}`); const data = await response.json() as Record<string, unknown>, rows = Array.isArray(data.matches) ? data.matches : [];
    return { available: true, matches: rows.map((item) => item as Record<string, unknown>).map((item) => ({ id: Number(item.id || item.questionId), score: Number(item.score || 0) })).filter((item) => Number.isInteger(item.id) && item.id > 0 && Number.isFinite(item.score)) };
  } catch { return { available: false, matches: [] as Array<{ id: number; score: number }> }; }
  finally { clearTimeout(timeout); }
}

export function localSemanticVector(text: string, dimensions = 192) {
  const vector = Array.from({ length: dimensions }, () => 0), normalized = text.toLowerCase().replace(/\s+/g, "");
  for (let index = 0; index < normalized.length; index++) {
    const token = normalized.slice(index, index + 2) || normalized[index];
    let hash = 2166136261;
    for (const character of token) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / length);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0, leftSize = 0, rightSize = 0;
  for (let index = 0; index < length; index++) { dot += left[index] * right[index]; leftSize += left[index] ** 2; rightSize += right[index] ** 2; }
  return leftSize && rightSize ? dot / Math.sqrt(leftSize * rightSize) : 0;
}
