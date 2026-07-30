import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("feedback import uses the resilient client for every server request", async () => {
  const page = await read("app/feedback-imports/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /studentLoadError/);
  assert.match(page, /重新读取学生名单/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("feedback import operations cannot overlap and always release busy state", async () => {
  const page = await read("app/feedback-imports/page.tsx");

  assert.match(page, /busyAction/);
  assert.match(page, /if \(busy\) return/);
  assert.match(page, /finally\s*\{\s*setBusyAction\(""\)/);
  assert.match(page, /draftSaved/);
  assert.match(page, /草稿已保存，但/);
});

test("confirming a feedback import requires a teacher decision and protects drafts", async () => {
  const page = await read("app/feedback-imports/page.tsx");

  assert.match(page, /window\.confirm/);
  assert.match(page, /hasUnsavedWork/);
  assert.match(page, /beforeunload/);
  assert.match(page, /confirmed/);
  assert.match(page, /disabled=\{busy/);
});

test("feedback import presents two explicit, evidence-backed steps", async () => {
  const page = await read("app/feedback-imports/page.tsx");

  for (const component of ["Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(page, /aria-label="反馈解析步骤"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /原文证据/);
  assert.match(page, /未发布作业草稿/);
});

test("feedback import styles are readable, touch-safe and mobile-first", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/feedback-imports.css"),
  ]);

  assert.match(layout, /import "\.\/feedback-imports\.css"/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
