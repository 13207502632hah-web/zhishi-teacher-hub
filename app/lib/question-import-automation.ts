import { env } from "cloudflare:workers";
import { getQuestionImportAutomationAccess, type AccessContext } from "./access";

const encoder = new TextEncoder();

const jsonError = (error: string, status: number, headers: HeadersInit = {}) => Response.json(
  { error },
  { status, headers: { "Cache-Control": "no-store", ...headers } },
);

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function securelyEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function requireQuestionImportAutomation(request: Request): Promise<AccessContext | Response> {
  const expected = String(env.QUESTION_IMPORT_AUTOMATION_TOKEN || "").trim();
  if (!expected) return jsonError("题库自动化导入尚未配置", 503);

  const match = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]{32,512})$/i);
  if (!match || !await securelyEqual(match[1], expected)) {
    return jsonError("题库自动化导入令牌无效", 401, { "WWW-Authenticate": "Bearer" });
  }

  const access = await getQuestionImportAutomationAccess();
  return access || jsonError("教师工作区尚未初始化", 503);
}
