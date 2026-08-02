import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");
const loadTsModule = async (path) => {
  const source = await read(path);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  new Function("module", "exports", outputText)(evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
};

test("question keywords wait for an explicit search and list requests use the resilient client", async () => {
  const page = await read("app/questions/page.tsx");

  assert.match(page, /appliedSearch/);
  assert.match(page, /submitSearch/);
  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.doesNotMatch(page, /useDebouncedValue/);
});

test("question list distinguishes loading, recoverable errors and genuine empty results", async () => {
  const page = await read("app/questions/page.tsx");

  assert.match(page, /listState/);
  assert.match(page, /正在整理题库/);
  assert.match(page, /题库读取失败/);
  assert.match(page, /重新读取题目/);
  assert.match(page, /没有符合当前筛选的题目/);
  assert.match(page, /aria-busy/);
});

test("saved question views use resilient requests and recoverable list states", async () => {
  const page = await read("app/questions/page.tsx");
  const savedViewFlow = page.match(/const loadViews[\s\S]*?const storePaperCart/)?.[0] || "";

  assert.match(savedViewFlow, /requestJson<.*SavedViewsResponse.*>\("\/api\/question-views"/s);
  assert.match(savedViewFlow, /savedViewRequest\.current\?\.abort\(\)/);
  assert.match(savedViewFlow, /signal: controller\.signal/);
  assert.match(savedViewFlow, /setSavedViewState\("loading"\)/);
  assert.match(savedViewFlow, /setSavedViewState\("error"\)/);
  assert.doesNotMatch(savedViewFlow, /\bfetch\s*\(/);
  assert.match(page, /筛选方案读取失败/);
  assert.match(page, /重新读取筛选方案/);
});

test("saved question view mutations validate input and prevent overlapping writes", async () => {
  const page = await read("app/questions/page.tsx");
  const savedViewFlow = page.match(/const loadViews[\s\S]*?const storePaperCart/)?.[0] || "";

  assert.match(page, /const savedViewActionRef\s*=\s*useRef<string \| null>\(null\)/);
  assert.match(savedViewFlow, /if \(savedViewActionRef\.current\) return/);
  assert.match(savedViewFlow, /if \(!name\)/);
  assert.match(savedViewFlow, /if \(!Object\.keys\(filters\)\.length\)/);
  assert.match(savedViewFlow, /requestJson<SavedViewResponse>\("\/api\/question-views"/);
  assert.match(savedViewFlow, /requestJson<\{ ok\?: boolean \}>\(`\/api\/question-views\/\$\{id\}`/);
  assert.match(savedViewFlow, /finally[\s\S]*savedViewActionRef\.current = null[\s\S]*setSavedViewBusy\(null\)/);
  assert.match(page, /disabled=\{Boolean\(savedViewBusy\)\}/);
});

test("question health metrics distinguish loading, failure, and real zero values", async () => {
  const page = await read("app/questions/page.tsx");
  const healthFlow = page.match(/const loadHealth[\s\S]*?useEffect\(\(\) => \{ const id =/)?.[0] || "";

  assert.match(page, /const healthRequest\s*=\s*useRef<AbortController \| null>\(null\)/);
  assert.match(healthFlow, /requestJson<QuestionHealthResponse>\(`\/api\/questions\/stats\?\$\{params\}`/);
  assert.match(healthFlow, /healthRequest\.current\?\.abort\(\)/);
  assert.match(healthFlow, /signal: controller\.signal/);
  assert.match(healthFlow, /setHealthState\("loading"\)/);
  assert.match(healthFlow, /setHealthState\("error"\)/);
  assert.doesNotMatch(healthFlow, /\bfetch\s*\(/);
  assert.match(page, /题库健康指标读取失败/);
  assert.match(page, /重新读取健康指标/);
  assert.match(page, /health && healthState !== "loading" && renderHealth\(healthState === "error"\)/);
  assert.match(page, /上次成功读取的题库健康指标/);
});

test("question filter facets preserve known options and recover from request failures", async () => {
  const page = await read("app/questions/page.tsx");
  const facetFlow = page.match(/const loadFacets[\s\S]*?const loadHealth/)?.[0] || "";

  assert.match(page, /const facetRequest\s*=\s*useRef<AbortController \| null>\(null\)/);
  assert.match(facetFlow, /requestJson<QuestionFacetsResponse>\(`\/api\/questions\/facets\?\$\{params\}`/);
  assert.match(facetFlow, /facetRequest\.current\?\.abort\(\)/);
  assert.match(facetFlow, /signal: controller\.signal/);
  assert.match(facetFlow, /setFacetState\("loading"\)/);
  assert.match(facetFlow, /setFacetState\("error"\)/);
  assert.match(facetFlow, /Object\.values\(data\.facets\)\.every\(Array\.isArray\)/);
  assert.doesNotMatch(facetFlow, /\bfetch\s*\(/);
  assert.match(page, /教材目录筛选读取失败/);
  assert.match(page, /重新读取教材目录/);
  assert.match(page, /教材目录选项来自上次成功读取/);
});

test("AI review lists preserve known results and recover from request failures", async () => {
  const page = await read("app/questions/page.tsx");
  const aiReviewFlow = page.match(/const loadAiReviews[\s\S]*?const loadFacets/)?.[0] || "";

  assert.match(page, /type AiReviewListResponse/);
  assert.match(page, /const aiReviewRequest\s*=\s*useRef<AbortController \| null>\(null\)/);
  assert.match(aiReviewFlow, /requestJson<AiReviewListResponse>\("\/api\/ai\/question-reviews"/);
  assert.match(aiReviewFlow, /aiReviewRequest\.current\?\.abort\(\)/);
  assert.match(aiReviewFlow, /signal: controller\.signal/);
  assert.match(aiReviewFlow, /setAiReviewState\("loading"\)/);
  assert.match(aiReviewFlow, /setAiReviewState\("error"\)/);
  assert.match(aiReviewFlow, /Array\.isArray\(data\.reviews\)/);
  assert.match(aiReviewFlow, /Array\.isArray\(data\.tasks\)/);
  assert.match(aiReviewFlow, /data\.reviews\.every\(isAiReviewRecord\)/);
  assert.match(aiReviewFlow, /data\.tasks\.every\(\(task\) => isAiReviewTaskRecord\(task\)\)/);
  assert.doesNotMatch(aiReviewFlow, /\bfetch\s*\(/);
  assert.match(page, /aria-busy=\{aiReviewState === "loading" \|\| aiReviewBusy\}/);
  assert.match(page, /AI 复核列表读取失败/);
  assert.match(page, /重新读取 AI 复核/);
  assert.match(page, /AI 复核结果来自上次成功读取/);
});

test("AI review mutations use a synchronous lock and recover without false success", async () => {
  const page = await read("app/questions/page.tsx");
  const mutationFlow = page.match(/const startAiReviewAction[\s\S]*?const reviewCount/)?.[0] || "";
  const processFlow = page.match(/const processAiTask[\s\S]*?const runAiReview/)?.[0] || "";
  const applyFlow = page.match(/const applyAiReviews[\s\S]*?const rejectAiReviews/)?.[0] || "";
  const rejectFlow = page.match(/const rejectAiReviews[\s\S]*?const reviewCount/)?.[0] || "";

  assert.match(page, /type AiReviewTaskResponse/);
  assert.match(page, /reused\?: boolean/);
  assert.match(page, /type AiReviewApplyResponse/);
  assert.match(page, /type AiReviewRejectResponse/);
  assert.match(page, /const isAiReviewRecord/);
  assert.match(page, /const isAiReviewTaskRecord/);
  assert.match(page, /const aiReviewActionRef\s*=\s*useRef<AiReviewAction \| null>\(null\)/);
  assert.match(mutationFlow, /if \(aiReviewActionRef\.current\) return false/);
  assert.match(mutationFlow, /requestJson<AiReviewTaskResponse>\("\/api\/ai\/question-reviews"/);
  assert.match(mutationFlow, /requestJson<AiReviewApplyResponse>\("\/api\/ai\/question-reviews\/apply"/);
  assert.match(mutationFlow, /requestJson<AiReviewRejectResponse>\("\/api\/ai\/question-reviews\/apply"/);
  assert.match(processFlow, /typeof data\.processed !== "number"/);
  assert.match(processFlow, /\["queued", "completed"\]/);
  assert.match(processFlow, /data\.task\.status === "queued" && data\.processed === 0/);
  assert.match(processFlow, /data\.reused/);
  assert.match(processFlow, /rerun: rerunRequested/);
  assert.match(processFlow, /再次调用 DeepSeek/);
  assert.match(mutationFlow, /Array\.isArray\(data\.applied\)/);
  assert.match(mutationFlow, /Array\.isArray\(data\.stale\)/);
  assert.match(mutationFlow, /Array\.isArray\(data\.skipped\)/);
  assert.match(applyFlow, /appliedIds/);
  assert.match(applyFlow, /requestedIdSet/);
  assert.match(applyFlow, /item\.changes\.length/);
  assert.match(page, /typeof change\.field === "string"/);
  assert.match(page, /typeof change\.before === "string"/);
  assert.match(page, /typeof change\.after === "string"/);
  assert.match(applyFlow, /refreshQuestions = true/);
  assert.match(mutationFlow, /data\.ok !== true/);
  assert.match(rejectFlow, /typeof data\.rejected !== "number"/);
  assert.match(rejectFlow, /data\.rejected > requestedIds\.length/);
  for (const flow of [processFlow, applyFlow, rejectFlow]) {
    assert.ok(flow.lastIndexOf("finishAiReviewAction()") > flow.lastIndexOf("await loadAiReviews()"), "AI review lock must remain held until reconciliation finishes");
  }
  assert.doesNotMatch(mutationFlow, /\bfetch\s*\(/);
  assert.match(page, /忽略后不会应用/);
  assert.match(page, /没有建议被忽略；建议可能已在其他页面处理/);
  assert.match(page, /请以当前列表为准/);
  assert.match(page, /正在应用…/);
  assert.match(page, /正在忽略…/);
});

test("question pagination is clamped after filtering instead of returning a false empty page", async () => {
  const route = await read("app/api/questions/route.ts");

  assert.match(route, /requestedPage/);
  assert.match(route, /Math\.min\(requestedPage,\s*pageCount\)/);
  assert.ok(
    route.indexOf("countRows") < route.indexOf("offset((page - 1)"),
    "the total must be known before the page offset is selected",
  );
});

test("adding many selected questions to a paper keeps every unique valid id", async () => {
  const { mergeQuestionSelection } = await loadTsModule("app/lib/question-list.ts");

  assert.deepEqual(mergeQuestionSelection([2, 7], [7, 9, 11]), [2, 7, 9, 11]);
  assert.deepEqual(mergeQuestionSelection([2], [0, -1, 3.5, Number.NaN, 4, 4]), [2, 4]);
});

test("question list styling follows the quiet study room tokens and mobile touch targets", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/questions-list.css"),
  ]);

  assert.match(layout, /import "\.\/questions-list\.css"/);
  assert.match(css, /#f5f2ea/i);
  assert.match(css, /#315346/i);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.savedSearchBar input\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*1rem/s);
  assert.match(css, /\.savedSearchBar button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.savedViewStatus\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.questionHealthState\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.facetState\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.aiReviewState\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.aiReviewPanel button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.aiSuggestionRow\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.aiSuggestionRow small,[\s\S]*?font-size:\s*0\.875rem/s);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
