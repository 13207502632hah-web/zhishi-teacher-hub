import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const loadTsModule = async (path) => {
  const source = await read(path);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const evaluated = { exports: {} };
  new Function("module", "exports", outputText)(evaluated, evaluated.exports);
  return evaluated.exports;
};

test("captured DeepSeek request recursively removes forbidden fields and embedded private values", async () => {
  const { buildDeepSeekRequest } = await loadTsModule("app/lib/ai/policy.ts");
  const request = buildDeepSeekRequest({ model: "deepseek-v4-flash", system: "test", thinking: false, maxTokens: 100, payload: {
    lesson: { topic: "法治", guardianPhone: "13800138000", nested: { wechatOpenId: "wx-secret", attachmentUrl: "https://files.example/a.docx" } },
    note: "联系 13900139000 或 138-0013-8000，微信号: wxTeacher88，另有 wxid_abcd1234，邮箱 user@example.com，session=abc123，Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature，附件 /tmp/private.pdf ![图](data:image/png;base64,abcdef)",
    sessionToken: "do-not-send",
  } });
  const captured = JSON.stringify(request.body);
  for (const secret of ["13800138000", "13900139000", "138-0013-8000", "wx-secret", "wxTeacher88", "wxid_abcd1234", "user@example.com", "abc123", "eyJhbGciOiJIUzI1NiJ9", "data:image/png", "abcdef", "files.example", "/tmp/private.pdf", "do-not-send"]) assert.doesNotMatch(captured, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(captured, /user_id|teacher_\d+/);
  assert.equal(request.body.thinking.type, "disabled");
});

test("retry policy retries only transient failures and at most once", async () => {
  const { shouldRetryDeepSeek } = await loadTsModule("app/lib/ai/policy.ts");
  assert.equal(shouldRetryDeepSeek(0, 429), true);
  assert.equal(shouldRetryDeepSeek(1, 429), false);
  assert.equal(shouldRetryDeepSeek(0, 500), true);
  assert.equal(shouldRetryDeepSeek(1, 503), false);
  assert.equal(shouldRetryDeepSeek(0, 401), false);
  assert.equal(shouldRetryDeepSeek(0, 402), false);
  assert.equal(shouldRetryDeepSeek(0, undefined, true), true);
  assert.equal(shouldRetryDeepSeek(1, undefined, true), false);
});

test("HTTP failure policy distinguishes invalid key, insufficient balance, throttling and service errors", async () => {
  const { deepSeekHttpFailure } = await loadTsModule("app/lib/ai/policy.ts");
  assert.deepEqual(deepSeekHttpFailure(401), { status: 503, code: "HTTP_401", message: "DeepSeek 密钥无效或已失效" });
  assert.equal(deepSeekHttpFailure(402).code, "HTTP_402");
  assert.equal(deepSeekHttpFailure(429).code, "HTTP_429");
  assert.equal(deepSeekHttpFailure(503).code, "HTTP_503");
});

test("mocked provider calls retry 429 and 5xx once, but never retry 401 or 402", async () => {
  const { executeDeepSeekRequest } = await loadTsModule("app/lib/ai/policy.ts");
  const ok = () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  for (const transient of [429, 500, 503]) {
    let calls = 0;
    const result = await executeDeepSeekRequest({ url: "https://example.invalid", apiKey: "test", body: {}, fetcher: async () => { calls += 1; return calls === 1 ? new Response("", { status: transient }) : ok(); } });
    assert.equal(calls, 2);
    assert.deepEqual(result.parsed, { ok: true });
  }
  for (const terminal of [401, 402]) {
    let calls = 0;
    await assert.rejects(() => executeDeepSeekRequest({ url: "https://example.invalid", apiKey: "test", body: {}, fetcher: async () => { calls += 1; return new Response("", { status: terminal }); } }), (error) => error.code === `HTTP_${terminal}`);
    assert.equal(calls, 1);
  }
});

test("provider resource interruption retries once but content and schema failures do not", async () => {
  const { executeDeepSeekRequest } = await loadTsModule("app/lib/ai/policy.ts");
  const response = (finishReason, content = '{"ok":true}') => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  let calls = 0;
  const recovered = await executeDeepSeekRequest({ url: "https://example.invalid", apiKey: "test", body: {}, fetcher: async () => { calls += 1; return calls === 1 ? response("insufficient_system_resource") : response("stop"); } });
  assert.equal(calls, 2);
  assert.deepEqual(recovered.parsed, { ok: true });
  for (const [finishReason, code] of [["content_filter", "FINISH_CONTENT_FILTER"], ["length", "TRUNCATED_RESPONSE"]]) {
    calls = 0;
    await assert.rejects(() => executeDeepSeekRequest({ url: "https://example.invalid", apiKey: "test", body: {}, fetcher: async () => { calls += 1; return response(finishReason); } }), (error) => error.code === code);
    assert.equal(calls, 1);
  }
});

test("mocked provider timeout retries once then returns NETWORK_ERROR", async () => {
  const { executeDeepSeekRequest } = await loadTsModule("app/lib/ai/policy.ts");
  let calls = 0;
  const fetcher = (_url, init) => { calls += 1; return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })); };
  await assert.rejects(() => executeDeepSeekRequest({ url: "https://example.invalid", apiKey: "test", body: {}, fetcher, timeoutMs: 5 }), (error) => error.code === "NETWORK_ERROR");
  assert.equal(calls, 2);
});

test("structured response rejects empty, truncated, malformed and non-object JSON", async () => {
  const { parseDeepSeekEnvelope } = await loadTsModule("app/lib/ai/policy.ts");
  const good = parseDeepSeekEnvelope({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }], usage: { total_tokens: 3 } });
  assert.deepEqual(good.parsed, { ok: true });
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ finish_reason: "length", message: { content: '{"x":1}' } }] }), (error) => error.code === "TRUNCATED_RESPONSE");
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ finish_reason: "stop", message: { content: "" } }] }), (error) => error.code === "EMPTY_RESPONSE");
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ finish_reason: "stop", message: { content: "{" } }] }), (error) => error.code === "INVALID_JSON");
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), (error) => error.code === "EMPTY_JSON");
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ finish_reason: "stop", message: { content: "[]" } }] }), (error) => error.code === "EMPTY_JSON");
  assert.throws(() => parseDeepSeekEnvelope({ choices: [{ message: { content: '{"ok":true}' } }] }), (error) => error.code === "FINISH_MISSING");
});

test("question review accepts omitted empty groups but still rejects non-object groups", async () => {
  const { normalizeOptionalJsonObject } = await loadTsModule("app/lib/ai/policy.ts");
  assert.deepEqual(normalizeOptionalJsonObject(undefined), {});
  assert.deepEqual(normalizeOptionalJsonObject(null), {});
  assert.deepEqual(normalizeOptionalJsonObject({ analysis: "逐题核对" }), { analysis: "逐题核对" });
  for (const invalid of [[], "", 1, true]) assert.throws(() => normalizeOptionalJsonObject(invalid), (error) => error.code === "SCHEMA_INVALID");
});

test("daily limit defaults to 50 and blocks the boundary call", async () => {
  const { dailyLimitReached } = await loadTsModule("app/lib/ai/policy.ts");
  assert.equal(dailyLimitReached(49, 50), false);
  assert.equal(dailyLimitReached(50, 50), true);
  assert.equal(dailyLimitReached(50, 0), true);
});

test("AI setting flags preserve database zero values instead of re-enabling privacy options", async () => {
  const { aiBoolean } = await loadTsModule("app/lib/ai/settings.ts");
  assert.equal(aiBoolean(undefined, true), true);
  assert.equal(aiBoolean(1), true);
  assert.equal(aiBoolean("1"), true);
  for (const value of [0, "0", false, null]) assert.equal(aiBoolean(value), false);
  const client = await read("app/settings/page.tsx"), route = await read("app/api/settings/ai/route.ts");
  assert.match(client, /includeStudentName:\s*aiBoolean\(current\.includeStudentName, true\)/);
  assert.match(client, /checked=\{aiBoolean\(ai\.settings\?\.includeStudentName, true\)\}/);
  assert.match(route, /includeName = aiBoolean\(body\.includeStudentName, true\) \? 1 : 0/);
});

test("server keeps secrets server-side, uses current models and never sends a login identifier", async () => {
  const server = await read("app/lib/ai/server.ts"), policy = await read("app/lib/ai/policy.ts"), migration = await read("drizzle/0026_deepseek_ai_assistance.sql");
  const clients = (await Promise.all(["app/feedback/page.tsx", "app/questions/page.tsx", "app/settings/page.tsx"].map(read))).join("\n");
  assert.match(server, /env\.DEEPSEEK_API_KEY/);
  assert.match(policy, /Authorization: `Bearer/);
  assert.doesNotMatch(server, /user_id:\s*`teacher_/);
  assert.doesNotMatch(clients, /DEEPSEEK_API_KEY|api\.deepseek\.com|Authorization.*Bearer/);
  assert.match(migration, /deepseek-v4-flash/);
  assert.match(migration, /deepseek-v4-pro/);
});

test("AI routes enforce teacher-only access, privacy acknowledgement and no write before validated output", async () => {
  const { aiRoleAllowed } = await loadTsModule("app/lib/ai/policy.ts");
  const server = await read("app/lib/ai/server.ts"), feedbackRoute = await read("app/api/ai/feedback-drafts/route.ts"), reviewRoute = await read("app/api/ai/question-reviews/route.ts");
  const protectedRoutes = await Promise.all([
    "app/api/ai/feedback-drafts/route.ts",
    "app/api/ai/question-reviews/route.ts",
    "app/api/ai/question-reviews/apply/route.ts",
    "app/api/ai/usage/route.ts",
    "app/api/settings/ai/route.ts",
  ].map(read));
  assert.equal(aiRoleAllowed("teacher"), true);
  for (const role of ["assistant", "student", "parent", "anonymous", ""]) assert.equal(aiRoleAllowed(role), false);
  for (const route of protectedRoutes) {
    assert.match(route, /requirePermission/);
    assert.match(route, /requireAiTeacher/);
  }
  assert.match(server, /requireAiTeacher/);
  assert.match(server, /PRIVACY_ACK_REQUIRED/);
  assert.match(server, /DAILY_LIMIT/);
  assert.match(server, /INSERT INTO ai_runs[\s\S]+SELECT[\s\S]+datetime\(created_at,'\+8 hours'\)[\s\S]+RETURNING id/);
  assert.match(server, /DEEPSEEK_AI_ENABLED !== "true"/);
  assert.ok(feedbackRoute.indexOf("const result = await callDeepSeekJson") < feedbackRoute.indexOf("INSERT INTO ai_feedback_drafts"));
  assert.ok(reviewRoute.indexOf("result = await callDeepSeekJson") < reviewRoute.indexOf("INSERT INTO ai_question_reviews"));
});

test("question review is resumable, batches ten, reserves Pro for single deep review and protects sensitive fields", async () => {
  const review = await read("app/api/ai/question-reviews/route.ts"), apply = await read("app/api/ai/question-reviews/apply/route.ts"), migration = await read("drizzle/0027_ai_workflow_completion.sql");
  assert.match(review, /ids\.length > 100/);
  assert.match(review, /slice\(cursor, cursor \+ 10\)/);
  assert.match(review, /status='running'[\s\S]+cursor=\?[\s\S]+datetime\(updated_at\)<datetime\('now','-3 minutes'\)/);
  assert.match(review, /WHERE id=\? AND user_id=\?/);
  assert.match(review, /AI 审核置信度缺失或超出范围/);
  assert.match(review, /body\.deepReview && ids\.length !== 1/);
  assert.match(review, /useProModel: deep/);
  assert.match(review, /task\.mode === "deep"/);
  assert.match(apply, /mode === "single" && ids\.length !== 1/);
  assert.match(apply, /allowed = mode === "single"[^\n]+SENSITIVE_QUESTION_FIELDS[^\n]+SAFE_QUESTION_FIELDS/);
  assert.match(apply, /mode === "batch" && !eligible\.has\(field\)/);
  assert.match(apply, /UPDATE questions SET \$\{setSql\},updated_at=\? WHERE id=\? AND updated_at=\?/);
  assert.match(apply, /env\.DB\.batch\(\[questionUpdate, reviewUpdate\]\)/);
  assert.match(apply, /preservesFormalReview: true/);
  assert.doesNotMatch(apply, /reviewed\s*=|status='active'/);
  assert.match(migration, /ai_question_review_tasks/);
});

test("feedback learning stores redacted saved-version differences and retrieves twelve matched examples", async () => {
  const createRoute = await read("app/api/feedback/route.ts"), updateRoute = await read("app/api/feedback/[id]/route.ts"), learning = await read("app/lib/ai/learning.ts");
  assert.match(createRoute, /recordFeedbackLearningEvent/);
  assert.match(updateRoute, /recordFeedbackLearningEvent/);
  assert.match(learning, /redactPrivateText/);
  assert.match(learning, /before:/);
  assert.match(learning, /after:/);
  assert.match(learning, /changedFields/);
  assert.match(learning, /if \(afterTemplate === beforeTemplate\) return/);
  assert.match(learning, /LIMIT 12/);
  assert.match(learning, /INSERT OR IGNORE INTO ai_feedback_learning_events/);
});

test("feedback AI requires exact preflight, binds draft context and supports discard", async () => {
  const aiRoute = await read("app/api/ai/feedback-drafts/route.ts"), createRoute = await read("app/api/feedback/route.ts"), updateRoute = await read("app/api/feedback/[id]/route.ts"), client = await read("app/feedback/page.tsx");
  assert.match(aiRoute, /body\.preview === true/);
  assert.match(aiRoute, /studentNames[\s\S]+allNames[\s\S]+redactNames/);
  assert.match(aiRoute, /export async function DELETE/);
  for (const source of [createRoute, updateRoute]) assert.match(source, /课时或学生已改变，请重新生成 AI 草稿/);
  assert.match(client, /尚未调用 DeepSeek/);
  assert.match(client, /form\.aiPreviewKey !== previewKey/);
  assert.match(client, /discardAiDraft/);
});

test("AI usage and daily boundaries use Asia Shanghai time and include readiness failures", async () => {
  const usage = await read("app/lib/ai/usage.ts"), server = await read("app/lib/ai/server.ts");
  for (const source of [usage, server]) assert.match(source, /datetime\([^)]*,'\+8 hours'\)/);
  assert.match(usage, /audit_logs/);
  assert.match(usage, /generate_failed/);
});

test("all AI generation, apply, reject and learning-clear operations are audited", async () => {
  const sources = (await Promise.all(["app/api/ai/feedback-drafts/route.ts", "app/api/ai/question-reviews/route.ts", "app/api/ai/question-reviews/apply/route.ts", "app/api/settings/ai/route.ts"].map(read))).join("\n");
  for (const action of ["generate", "generate_failed", "apply_ai_suggestion", "reject", "delete_all"]) assert.match(sources, new RegExp(`audit\\(access, [\"']${action}[\"']`));
});
