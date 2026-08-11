import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

export async function GET() {
  const access = await requirePermission("settings:read");
  if (isDenied(access)) return access;
  let providerHost = "opencode.ai";
  try { providerHost = new URL(String(env.OPENAI_BASE_URL || "https://opencode.ai/zen/go/v1")).host; } catch { /* keep the public default label */ }
  const jobs = await env.DB.prepare("SELECT state,COUNT(*) AS total FROM v2_jobs GROUP BY state").all();
  return Response.json({
    configured: Boolean(env.OPENAI_API_KEY),
    providerHost,
    models: {
      fast: env.OPENAI_FAST_MODEL || "deepseek-v4-flash",
      reasoning: env.OPENAI_REASONING_MODEL || "gpt-5.6-luna",
      vision: env.OPENAI_VISION_MODEL || "mimo-v2-omni",
      embedding: env.OPENAI_EMBEDDING_MODEL || "待配置",
    },
    qualityFirst: true,
    costOrTokenFeatureLimit: false,
    jobs: jobs.results,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
