import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("lesson list uses the resilient request client and recoverable loading states", async () => {
  const page = await read("app/lessons/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /lessonLoadError/);
  assert.match(page, /重新读取课时/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("lesson search is explicit and mutations prevent duplicate submission", async () => {
  const page = await read("app/lessons/page.tsx");

  assert.match(page, /searchInput/);
  assert.match(page, /setQuery\(searchInput\.trim\(\)\)/);
  assert.match(page, /aria-label="搜索课时"/);
  assert.match(page, /submitting/);
  assert.match(page, /if \(submitting\) return/);
  assert.match(page, /disabled=\{submitting\}/);
});

test("lesson list uses shared primitives for states and lesson status", async () => {
  const page = await read("app/lessons/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /aria-pressed=\{view ===/);
});

test("lesson list styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/lessons.css"),
  ]);

  assert.match(layout, /import "\.\/lessons\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
