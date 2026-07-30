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
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
