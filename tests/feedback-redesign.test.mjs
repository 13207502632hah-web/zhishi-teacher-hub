import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("feedback center uses the resilient client and recoverable loading states", async () => {
  const page = await read("app/feedback/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /feedbackLoadError/);
  assert.match(page, /normalizeFeedbackForm/);
  assert.match(page, /重新读取反馈/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("feedback mutations cannot double submit and copy state follows the clipboard", async () => {
  const page = await read("app/feedback/page.tsx");

  assert.match(page, /if \(busy\) return/);
  assert.match(page, /finally/);
  assert.match(page, /disabled=\{busy/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.ok(
    page.indexOf("navigator.clipboard.writeText") < page.indexOf("/copied"),
    "clipboard write must happen before the server records a copied state",
  );
});

test("feedback center uses shared metrics, panels and statuses", async () => {
  const page = await read("app/feedback/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /aria-label="反馈筛选"/);
  assert.match(page, /aria-label="反馈概览"/);
});

test("feedback dialog restores focus and protects unsaved work", async () => {
  const page = await read("app/feedback/page.tsx");

  assert.match(page, /useRef/);
  assert.match(page, /beforeunload/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "Tab"/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /previousFocusRef\.current\?\.focus/);
  assert.match(page, /tabIndex=\{-1\}/);
  assert.match(page, /formDirty/);
});

test("feedback center styles are readable, touch-safe and mobile-first", async () => {
  const [layout, page, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/feedback/page.tsx"),
    read("app/feedback.css"),
  ]);

  assert.match(layout, /import "\.\/feedback\.css"/);
  assert.match(page, /modalBackdrop feedbackModalBackdrop/);
  assert.match(css, /\.feedbackModalBackdrop\s*\{[^}]*z-index:\s*(?:[5-9]\d|[1-9]\d{2,})/s);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
