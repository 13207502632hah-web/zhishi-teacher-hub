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

test("paper candidates wait for explicit filters and every request uses the resilient client", async () => {
  const page = await read("app/papers/page.tsx");

  assert.match(page, /appliedFilters/);
  assert.match(page, /applyCandidateFilters/);
  assert.match(page, /requestJson/);
  assert.match(page, /candidateState/);
  assert.match(page, /重新读取候选题/);
});

test("paper draft restoration keeps saved layout only for currently active questions", async () => {
  const { restorePaperSelection } = await loadTsModule("app/lib/paper-workbench.ts");
  const saved = [
    { id: 2, score: 8, groupTitle: "一、选择题", answerSpace: 3, stem: "旧题干" },
    { id: 9, score: 5 },
  ];
  const active = [
    { id: 2, score: 3, stem: "最新题干", questionType: "单选题" },
    { id: 4, score: 4, stem: "另一题" },
  ];

  assert.deepEqual(restorePaperSelection(saved, active), [
    { id: 2, score: 8, stem: "最新题干", questionType: "单选题", groupTitle: "一、选择题", answerSpace: 3 },
  ]);
});

test("paper draft validation rejects missing titles, invalid scores and invalid duration", async () => {
  const { paperDraftIssues } = await loadTsModule("app/lib/paper-workbench.ts");

  assert.deepEqual(paperDraftIssues({ title: "", durationMinutes: "", questions: [] }), ["请填写试卷名称", "请至少选择一道题目"]);
  assert.deepEqual(paperDraftIssues({ title: "周测", durationMinutes: "0", questions: [{ id: 1, score: -1 }] }), ["第 1 题分值不能小于 0", "限时必须是大于 0 的整数"]);
  assert.deepEqual(paperDraftIssues({ title: "周测", durationMinutes: "45", questions: [{ id: 1, score: 3 }] }), []);
});

test("creating a paper draft does not count questions as already used", async () => {
  const route = await read("app/api/papers/route.ts");

  assert.doesNotMatch(route, /UPDATE questions SET use_count=use_count\+1/);
});

test("paper workbench styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([read("app/layout.tsx"), read("app/paper-workbench.css")]);

  assert.match(layout, /import "\.\/paper-workbench\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /#315346/i);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
