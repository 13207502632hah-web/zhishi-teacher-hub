import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("paper detail uses resilient JSON requests and recoverable load states", async () => {
  const page = await read("app/papers/[id]/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /paperDetailLoadError/);
  assert.match(page, /重新读取试卷/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("paper detail mutations cannot overlap and always release busy state", async () => {
  const page = await read("app/papers/[id]/page.tsx");

  assert.match(page, /actionBusy/);
  assert.match(page, /if \(actionBusy\) return/);
  assert.match(page, /finally\s*\{\s*setActionBusy\(""\)/);
  assert.match(page, /finally\s*\{\s*setAiReviewBusy\(false\)/);
  assert.match(page, /disabled=\{Boolean\(actionBusy\)/);
  assert.match(page, /window\.confirm/);
});

test("paper assignment dialog restores focus and protects unsaved work", async () => {
  const page = await read("app/papers/[id]/page.tsx");

  assert.match(page, /dialogRef/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /beforeunload/);
  assert.match(page, /作业信息尚未保存/);
  assert.match(page, /aria-labelledby="paper-assignment-title"/);
  assert.match(page, /tabIndex=\{-1\}/);
});

test("paper detail uses shared panels, metrics and status language", async () => {
  const page = await read("app/papers/[id]/page.tsx");

  for (const component of ["EmptyState", "MetricCard", "Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /paperDetailMetrics/);
  assert.match(page, /paperDetailModeSwitch/);
  assert.match(page, /paperDetailNotice/);
});

test("paper detail styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/paper-detail.css"),
  ]);

  assert.match(layout, /import "\.\/paper-detail\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
