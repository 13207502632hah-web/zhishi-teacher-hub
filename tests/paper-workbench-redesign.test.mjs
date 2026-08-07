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

test("paper candidates paginate through the bank with totals and load more", async () => {
  const page = await read("app/papers/page.tsx");

  assert.match(page, /page: String\(page\)/);
  assert.match(page, /candidateTotal/);
  assert.match(page, /candidatePageCount/);
  assert.match(page, /共 \{candidateTotal \|\| bank\.length\} 题/);
  assert.match(page, /已显示 \{bank\.length\} 题/);
  assert.match(page, /candidateLimited/);
  assert.match(page, /加载更多候选题/);
  assert.match(page, /candidateLoadMore/);
  assert.match(page, /bank\.map\(\(item\) =>/);
  assert.doesNotMatch(page, /bank\.slice\(0, 100\)/);
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

test("paper recommendation reaches target score with balanced distributions", async () => {
  const { recommendPaperQuestions } = await loadTsModule("app/lib/paper-recommend.ts");
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    stem: `推荐题 ${index + 1}`,
    score: 10,
    questionType: index % 2 === 0 ? "单选题" : "材料题",
    difficulty: (index % 5) + 1,
    useCount: index,
    knowledgePoints: index % 2 === 0 ? "全过程人民民主" : "法治意识",
  }));

  const result = recommendPaperQuestions({ candidates, count: 10, targetScore: 100, excludeRecent: true });

  assert.equal(result.picked.length, 10);
  assert.equal(result.totalScore, 100);
  assert.equal(result.countGap, 0);
  assert.equal(result.scoreGap, 0);
  assert.equal(result.reachedTarget, true);
  assert.ok(result.reasons.some((reason) => reason.includes("已达到目标总分")));
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.distributions.types).map(([type, info]) => [type, info.count])),
    { 单选题: 5, 材料题: 5 },
  );
  assert.ok(result.distributions.knowledge.covered.includes("全过程人民民主"));
  assert.ok(result.distributions.knowledge.covered.includes("法治意识"));
});

test("paper recommendation reports count and score gaps when candidates are insufficient", async () => {
  const { recommendPaperQuestions } = await loadTsModule("app/lib/paper-recommend.ts");
  const candidates = Array.from({ length: 3 }, (_, index) => ({
    id: index + 1,
    stem: `不足题 ${index + 1}`,
    score: 10,
    questionType: "单选题",
    difficulty: 3,
    knowledgePoints: "人民民主",
  }));

  const result = recommendPaperQuestions({ candidates, count: 10, targetScore: 100 });

  assert.equal(result.picked.length, 3);
  assert.equal(result.totalScore, 30);
  assert.equal(result.countGap, 7);
  assert.equal(result.scoreGap, 70);
  assert.equal(result.reachedTarget, false);
  assert.ok(result.reasons.some((reason) => reason.includes("还差 70 分")));
  assert.ok(result.reasons.some((reason) => reason.includes("还可补充 7 题")));
});

test("paper recommendation drops invalid and zero-score candidates", async () => {
  const { recommendPaperQuestions } = await loadTsModule("app/lib/paper-recommend.ts");
  const candidates = [
    { id: 0, stem: "无效题", score: 10 },
    { id: 2, stem: "零分题", score: 0 },
    { id: 3, stem: "", score: 10 },
    { id: 4, stem: "可用题", score: 5, questionType: "单选题", difficulty: 2, knowledgePoints: "法治意识" },
  ];

  const result = recommendPaperQuestions({ candidates, count: 10, targetScore: 20 });

  assert.deepEqual(result.picked.map((item) => item.id), [4]);
  assert.equal(result.totalScore, 5);
  assert.equal(result.reachedTarget, false);
  assert.equal(result.scoreGap, 15);
});

test("paper workbench exposes clear actions, recommendation engine and candidate totals", async () => {
  const page = await read("app/papers/page.tsx");

  assert.match(page, /recommendPaperQuestions/);
  assert.match(page, /loadAllCandidates/);
  assert.match(page, /candidate=1/);
  assert.match(page, /清空筛选条件/);
  assert.match(page, /清空已选题/);
  assert.match(page, /结构概览：题型 \/ 难度 \/ 知识点 \/ 目标差额/);
  assert.match(page, /recommendReport\.reasons/);
  assert.match(page, /workbenchClear/);
});

test("saved paper filters persist to the URL and restore on refresh", async () => {
  const page = await read("app/papers/page.tsx");

  assert.match(page, /new URLSearchParams\(location\.search\)/);
  assert.match(page, /params\.get\("paperSearch"\)/);
  assert.match(page, /params\.get\("paperStatus"\)/);
  assert.match(page, /params\.get\("academicYear"\)/);
  assert.match(page, /params\.get\("province"\)/);
  assert.match(page, /if \(value\) query\.set\(key, value\)/);
  assert.match(page, /history\.replaceState\(null, "", `\/papers/);
  assert.match(page, /clearPaperFilters/);
  assert.match(page, /清空试卷筛选/);
});
