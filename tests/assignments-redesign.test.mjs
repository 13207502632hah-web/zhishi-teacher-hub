import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("assignment center uses the resilient client and recoverable load states", async () => {
  const page = await read("app/assignments/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /assignmentLoadError/);
  assert.match(page, /重新读取作业/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("assignment search is explicit and mutations cannot double submit", async () => {
  const page = await read("app/assignments/page.tsx");

  assert.match(page, /searchInput/);
  assert.match(page, /setQuery\(searchInput\.trim\(\)\)/);
  assert.match(page, /aria-label="搜索作业"/);
  assert.match(page, /if \(busy\) return/);
  assert.match(page, /disabled=\{busy/);
  assert.match(page, /finally/);
});

test("assignment center uses shared metrics, panels and statuses", async () => {
  const page = await read("app/assignments/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /aria-label="作业筛选"/);
});

test("assignment dialogs restore focus and protect unsaved work", async () => {
  const page = await read("app/assignments/page.tsx");

  assert.match(page, /useRef/);
  assert.match(page, /beforeunload/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "Tab"/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /previousFocusRef\.current\?\.focus/);
  assert.match(page, /tabIndex=\{-1\}/);
  assert.match(page, /reviewDirty/);
});

test("assignment center styles are readable, touch-safe and mobile-first", async () => {
  const [layout, page, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/assignments/page.tsx"),
    read("app/assignments.css"),
  ]);

  assert.match(layout, /import "\.\/assignments\.css"/);
  assert.match(page, /modalBackdrop assignmentModalBackdrop/);
  assert.match(css, /\.assignmentModalBackdrop\s*\{[^}]*z-index:\s*(?:[5-9]\d|[1-9]\d{2,})/s);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
