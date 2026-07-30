import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("assessment list uses the resilient client and recoverable loading states", async () => {
  const page = await read("app/assessments/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /assessmentLoadError/);
  assert.match(page, /重新读取测验/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("assessment creation cannot double submit and always releases busy state", async () => {
  const page = await read("app/assessments/page.tsx");

  assert.match(page, /submitting/);
  assert.match(page, /if \(submitting\) return/);
  assert.match(page, /finally\s*\{\s*setSubmitting\(false\)/);
  assert.match(page, /disabled=\{submitting\}/);
  assert.match(page, /创建中…/);
});

test("assessment list uses shared metrics, panels and status language", async () => {
  const page = await read("app/assessments/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /assessmentMetrics/);
  assert.match(page, /aria-label="筛选测验"/);
});

test("assessment dialog restores focus and protects unsaved work", async () => {
  const page = await read("app/assessments/page.tsx");

  assert.match(page, /useRef/);
  assert.match(page, /formDirty/);
  assert.match(page, /beforeunload/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "Tab"/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /tabIndex=\{-1\}/);
});

test("assessment list styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/assessments-list.css"),
  ]);

  assert.match(layout, /import "\.\/assessments-list\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /z-index:\s*8\d/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
