import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../app/lib/v2/question-import-service.ts", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function validateQuestions("), source.indexOf("export async function createQuestionImportV2("));
const compiled = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const api = new Function(`${compiled}; return { validateQuestionPage, validateAnswerPage, savedQuestionPages, savedAnswerPages, mergeQuestionPages, mergeAnswerPages, mergeVisualQuestions };`)();
const persist = (value) => JSON.parse(JSON.stringify(value));

test("question continuations survive checkpoints and span multiple continuation-only pages", () => {
  let pages = [api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 8, stem: "建设美好集体需要", options: "A. 包容\nB. 合作" }] })];
  pages = api.savedQuestionPages(persist(pages));
  pages.push(api.validateQuestionPage({ questions: [], continuationForPreviousQuestion: { options: ["C. 参与"] } }));
  pages = api.savedQuestionPages(persist(pages));
  pages.push(api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 9, stem: "下一题" }], continuationForPreviousQuestion: { options: ["D. 担当"] } }));
  const questions = api.mergeVisualQuestions(api.mergeQuestionPages(api.savedQuestionPages(persist(pages))), []);
  assert.deepEqual(questions.map((row) => row.sourceQuestionNumber), [8, 9]);
  assert.equal(questions[0].options, "A. 包容\nB. 合作\nC. 参与\nD. 担当");
  assert.equal(questions[1].stem, "下一题");
});

test("answer continuations survive checkpoints and remain attached to the original number", () => {
  const pages = [
    api.validateAnswerPage({ answers: [{ sourceQuestionNumber: 31, answer: "第一点", analysis: "第一段" }] }),
    api.validateAnswerPage({ answers: [], continuationForPreviousAnswer: { answer: "第二点", analysis: "第二段" } }),
    api.validateAnswerPage({ answers: [{ sourceQuestionNumber: 32, answer: "下一题答案" }], continuationForPreviousAnswer: { answer: "第三点", analysis: "第三段" } }),
  ];
  const questions = api.mergeVisualQuestions([{ sourceQuestionNumber: 31, stem: "题目31" }, { sourceQuestionNumber: 32, stem: "题目32" }], api.mergeAnswerPages(api.savedAnswerPages(persist(pages))));
  assert.equal(questions[0].answer, "第一点\n第二点\n第三点");
  assert.equal(questions[0].analysis, "第一段\n第二段\n第三段");
  assert.equal(questions[1].answer, "下一题答案");
});

test("AI timeout also bounds a stalled response body after headers arrive", async () => {
  const router = readFileSync(new URL("../app/lib/v2/ai-router.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(router, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const updates = [], env = { OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://example.invalid/v1", OPENAI_VISION_MODEL: "fixture-model", DB: { prepare(sql) { return { bind(...values) { return { first: async () => ({ id: "run" }), run: async () => { updates.push({ sql, values }); } }; } }; } } };
  const evaluated = { exports: {} };
  const fetcher = async (_url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("body timeout")), { once: true }); }) });
  new Function("module", "exports", "require", "fetch", code)(evaluated, evaluated.exports, (name) => name === "cloudflare:workers" ? { env } : { anonymizeForAi: (value) => ({ value, report: {} }), safeInputSummary: () => "fixture" }, fetcher);
  const started = Date.now();
  await assert.rejects(evaluated.exports.callV2AiJson({ access: { id: 1 }, capability: "vision", system: "fixture", payload: {}, promptVersion: "fixture", timeoutMs: 20, validate: (value) => value }), /ALL_MODELS_FAILED|未返回合格结果/);
  assert.ok(Date.now() - started < 1000);
  assert.ok(updates.some((row) => row.values.includes("NETWORK_ERROR")));
});
