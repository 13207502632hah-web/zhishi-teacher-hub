import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../app/lib/v2/question-import-service.ts", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("type ImportedTable"), source.indexOf("export async function createQuestionImportV2("));
const compiled = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const api = new Function(`${compiled}; return { validateQuestionPage, validateAnswerPage, savedQuestionPages, savedAnswerPages, mergeQuestionPages, mergeAnswerPages, mergeVisualQuestions, validatePairedQuestionNumbers, finalizeQuestionPages };`)();
const persist = (value) => JSON.parse(JSON.stringify(value));

test("paired papers cannot silently omit questions that appear in the answer sheet", () => {
  const questions = [1, 2, 5].map((sourceQuestionNumber) => ({ sourceQuestionNumber, stem: `题目${sourceQuestionNumber}` }));
  const answers = [1, 2, 3, 4, 5].map((sourceQuestionNumber) => ({ sourceQuestionNumber, answer: "A" }));
  assert.throws(() => api.validatePairedQuestionNumbers(questions, answers), /漏识别第 3、4 题/);
  assert.doesNotThrow(() => api.validatePairedQuestionNumbers(questions, [answers[0], answers[1], answers[4]]));
});

test("repeated cross-page numbers are merged instead of discarding the shorter question fragment", () => {
  const pages = [
    api.validateQuestionPage({ document: { stage: "初中", grade: "九年级", year: 2026, region: "天津", choiceScore: 2, choiceOptionCount: 4 }, questions: [{ sourceQuestionNumber: 4, material: "教育部印发指导意见", stem: "下面大课间的安排有利于学生", questionType: "单选题" }] }),
    api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 4, stem: "（题干缺失，根据选项推测为选择活动主题）", material: "周一：集体舞", options: ["A. 文化", "B. 冠军", "C. 成长", "D. 合作"], questionType: "单选题" }, { sourceQuestionNumber: 30, stem: "（题目未完，待续）", material: "经济桥、民生桥、互通桥" }] }),
    api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 30, stem: "结合材料，谈谈这些桥蕴含哪些道理。", material: "攀云筑梦桥", score: 8 }] }),
  ];
  const questions = api.finalizeQuestionPages(api.savedQuestionPages(persist(pages)));
  assert.equal(questions.length, 2);
  assert.equal(questions[0].stem, "下面大课间的安排有利于学生");
  assert.match(questions[0].material, /指导意见\n周一/);
  assert.equal(questions[0].score, 2);
  assert.equal(questions[0].stage, "初中");
  assert.equal(questions[0].grade, "九年级");
  assert.equal(questions[1].stem, "结合材料，谈谈这些桥蕴含哪些道理。");
  assert.match(questions[1].material, /互通桥\n攀云筑梦桥/);
  assert.equal(questions[1].score, 8);
});

test("assembly refuses missing stems, incomplete four-option choices and unstructured continuations", () => {
  assert.throws(() => api.finalizeQuestionPages([{ document: {}, continuation: null, questions: [{ sourceQuestionNumber: 30, stem: "（题目未完，待续）" }] }]), /缺少完整题干/);
  assert.throws(() => api.finalizeQuestionPages([{ document: { choiceOptionCount: 4 }, continuation: null, questions: [{ sourceQuestionNumber: 8, stem: "集体建设", questionType: "单选题", options: "A. 包容\nB. 合作" }] }]), /选项不完整/);
  assert.throws(() => api.validateQuestionPage({ questions: [], continuationForPreviousQuestion: { text: "C. 沟通 D. 竞争" } }), /跨页续文缺少有效内容/);
  assert.throws(() => api.finalizeQuestionPages([{ document: {}, continuation: null, questions: [{ sourceQuestionNumber: 3, stem: "（　　）" }] }]), /缺少完整题干/);
  assert.throws(() => api.finalizeQuestionPages([{ document: {}, continuation: null, questions: [{ sourceQuestionNumber: 5, stem: "事迹告诉我们", questionType: "单选题", options: "A. ①②\nB. ①③\nC. ②④\nD. ③④" }] }]), /缺少组合选项对应的陈述/);
});

test("data charts require a complete rectangular table before a page can be checkpointed", () => {
  assert.throws(() => api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 4, material: "根据柱状图回答问题", stem: "从图中可以看出什么？", tables: [] }] }), /提到图表但未返回结构化数据/);
  assert.throws(() => api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 4, material: "居民收入统计图", stem: "概括变化", tables: [{ kind: "bar_chart", rowCount: 3, columnCount: 3, complete: true, rows: [["年份", "城镇", "农村"], ["2023", "51821", "21691"]] }] }] }), /图表数据不完整/);
  const page = api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 4, material: "居民收入柱状图", stem: "概括变化", tables: [{ kind: "bar_chart", title: "居民收入情况", unit: "元", rowCount: 3, columnCount: 3, complete: true, rows: [["年份", "城镇", "农村"], ["2023", "51821", "21691"], ["2024", "54188", "23119"]] }] }] });
  assert.deepEqual(page.questions[0].tables[0].rows[2], ["2024", "54188", "23119"]);
  assert.equal(page.questions[0].tables[0].needsReview, false);
});

test("structured charts survive cross-page merging", () => {
  const pages = [
    api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 25, material: "统计图", stem: "阅读材料", tables: [{ kind: "line_chart", rowCount: 2, columnCount: 2, complete: true, rows: [["年份", "数值"], ["2024", "100"]] }] }] }),
    api.validateQuestionPage({ questions: [{ sourceQuestionNumber: 25, stem: "回答问题", tables: [{ kind: "table", rowCount: 2, columnCount: 2, complete: true, rows: [["项目", "结果"], ["A", "B"]] }] }] }),
  ];
  const merged = api.mergeQuestionPages(api.savedQuestionPages(persist(pages)));
  assert.equal(merged[0].tables.length, 2);
});

test("answer labels are not counted as the actual answer", () => {
  const page = api.validateAnswerPage({ answers: [{ sourceQuestionNumber: 25, answer: "示例", answerPoints: ["①学会独立思考。", "②向榜样学习。"] }, { sourceQuestionNumber: 26, answer: "示例", analysis: "仅有解析" }] });
  assert.equal(page.answers[0].answer, "①学会独立思考。\n②向榜样学习。");
  assert.equal(page.answers[1].answer, "");
});

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
  const updates = [], env = { OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://example.invalid/v1", OPENAI_VISION_MODEL: "mimo-v2.5", DB: { prepare(sql) { return { bind(...values) { return { first: async () => ({ id: "run" }), run: async () => { updates.push({ sql, values }); } }; } }; } } };
  const evaluated = { exports: {} };
  const fetcher = async (_url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("body timeout")), { once: true }); }) });
  new Function("module", "exports", "require", "fetch", code)(evaluated, evaluated.exports, (name) => name === "cloudflare:workers" ? { env } : { anonymizeForAi: (value) => ({ value, report: {} }), safeInputSummary: () => "fixture" }, fetcher);
  const started = Date.now();
  await assert.rejects(evaluated.exports.callV2AiJson({ access: { id: 1 }, capability: "vision", system: "fixture", payload: {}, promptVersion: "fixture", timeoutMs: 20, validate: (value) => value }), /ALL_MODELS_FAILED|未返回合格结果/);
  assert.ok(Date.now() - started < 1000);
  assert.ok(updates.some((row) => row.values.includes("NETWORK_ERROR")));
});

test("transient transport failures retry once with a fresh provider session", async () => {
  const router = readFileSync(new URL("../app/lib/v2/ai-router.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(router, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [], updates = [];
  const env = { OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://example.invalid/v1", OPENAI_VISION_MODEL: "fixture-model", DB: { prepare(sql) { return { bind(...values) { return { first: async () => ({ id: "run" }), run: async () => { updates.push({ sql, values }); } }; } }; } } };
  const evaluated = { exports: {} };
  const fetcher = async (_url, request) => {
    requests.push(request);
    if (requests.length === 1) throw new Error("connection reset");
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"questions":[]}' } }] }) };
  };
  new Function("module", "exports", "require", "fetch", code)(evaluated, evaluated.exports, (name) => name === "cloudflare:workers" ? { env } : { anonymizeForAi: (value) => ({ value, report: {} }), safeInputSummary: () => "fixture" }, fetcher);
  const result = await evaluated.exports.callV2AiJson({ access: { id: 1 }, capability: "vision", system: "fixture", payload: {}, promptVersion: "fixture", validate: (value) => value });
  assert.deepEqual(result.data, { questions: [] });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["User-Agent"], "zhishi-teacher-hub/2.0");
  assert.notEqual(requests[0].headers["x-opencode-session"], requests[1].headers["x-opencode-session"]);
  assert.ok(updates.some((row) => row.sql.includes("status='completed'")));
  assert.ok(!updates.some((row) => row.values.includes("NETWORK_ERROR")));
});

test("vision routing switches to a second multimodal model after the preferred model fails", async () => {
  const router = readFileSync(new URL("../app/lib/v2/ai-router.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(router, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const models = [], updates = [];
  const env = { OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://example.invalid/v1", OPENAI_VISION_MODEL: "kimi-k2.6", DB: { prepare(sql) { return { bind(...values) { return { first: async () => ({ id: "run" }), run: async () => { updates.push({ sql, values }); } }; } }; } } };
  const evaluated = { exports: {} };
  const fetcher = async (_url, request) => {
    const body = JSON.parse(request.body);
    models.push(body.model);
    if (body.model === "kimi-k2.6") return { ok: false, status: 502 };
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"questions":[]}' } }] }) };
  };
  new Function("module", "exports", "require", "fetch", code)(evaluated, evaluated.exports, (name) => name === "cloudflare:workers" ? { env } : { anonymizeForAi: (value) => ({ value, report: {} }), safeInputSummary: () => "fixture" }, fetcher);
  const result = await evaluated.exports.callV2AiJson({ access: { id: 1 }, capability: "vision", system: "fixture", payload: {}, promptVersion: "fixture", validate: (value) => value });
  assert.deepEqual(result.data, { questions: [] });
  assert.deepEqual(models, ["kimi-k2.6", "mimo-v2.5"]);
  assert.equal(result.model, "mimo-v2.5");
  assert.ok(updates.some((row) => row.values.includes("HTTP_502")));
  assert.ok(updates.some((row) => row.sql.includes("status='completed'")));
});

test("pure extraction uses instant mode and rejects truncated JSON even when syntactically valid", async () => {
  const router = readFileSync(new URL("../app/lib/v2/ai-router.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(router, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [], updates = [];
  const env = { OPENAI_API_KEY: "fixture-key", OPENAI_BASE_URL: "https://example.invalid/v1", OPENAI_VISION_MODEL: "kimi-k2.6", DB: { prepare(sql) { return { bind(...values) { return { first: async () => ({ id: "run" }), run: async () => { updates.push({ sql, values }); } }; } }; } } };
  const evaluated = { exports: {} };
  const fetcher = async (_url, request) => { requests.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: '{"questions":[]}' } }] }) }; };
  new Function("module", "exports", "require", "fetch", code)(evaluated, evaluated.exports, (name) => name === "cloudflare:workers" ? { env } : { anonymizeForAi: (value) => ({ value, report: {} }), safeInputSummary: () => "fixture" }, fetcher);
  await assert.rejects(evaluated.exports.callV2AiJson({ access: { id: 1 }, capability: "vision", system: "抄录", payload: {}, promptVersion: "fixture", thinking: "disabled", validate: () => { throw new Error("must not validate a truncated response"); } }), /OUTPUT_TRUNCATED/);
  assert.deepEqual(requests[0].thinking, { type: "disabled" });
  assert.ok(updates.some((row) => row.values.includes("OUTPUT_TRUNCATED")));
});
