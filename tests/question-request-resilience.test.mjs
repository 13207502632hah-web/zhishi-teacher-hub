import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all question-page API requests use the resilient JSON client", async () => {
  const page = await read("app/questions/page.tsx");

  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /response\.(?:json|text)\s*\(/);
  assert.match(page, /requestJson<[^>]+>\(`?\/api\/questions/);
  assert.match(page, /requestJson<[^>]+>\("\/api\/question-sets\/source"/);
  assert.match(page, /reason instanceof HttpError && reason\.status === 413/);
});

test("initial lesson and resumed import requests are abortable and always release page readiness", async () => {
  const page = await read("app/questions/page.tsx");
  const initialization = page.match(/useEffect\(\(\) => \{\s*const params = new URLSearchParams\(location\.search\)[\s\S]*?return \(\) => controller\.abort\(\);\s*\}, \[\]\);/)?.[0] || "";

  assert.match(page, /const bootstrapRequest\s*=\s*useRef<AbortController \| null>\(null\)/);
  assert.match(initialization, /const controller = new AbortController\(\)/);
  assert.match(initialization, /signal: controller\.signal/);
  assert.match(initialization, /finally\s*\{\s*if \(!controller\.signal\.aborted\) setReady\(true\)/);
  assert.match(initialization, /return \(\) => controller\.abort\(\)/);
  assert.equal((page.match(/requestJson<QuestionSetResponse>\(`\/api\/question-sets\/\$\{resumeId\}`/g) || []).length, 1);
});

test("question mutations use a synchronous lock and expose disabled controls", async () => {
  const page = await read("app/questions/page.tsx");
  const mutations = page.match(/const save = async[\s\S]*?const loadQuestionContent/)?.[0] || "";

  assert.match(page, /const questionActionRef\s*=\s*useRef<string \| null>\(null\)/);
  assert.match(page, /const startQuestionAction/);
  assert.match(page, /if \(questionActionRef\.current\) return false/);
  assert.match(mutations, /finally\s*\{\s*finishQuestionAction\(action\)/);
  assert.doesNotMatch(mutations, /\bfetch\s*\(/);
  assert.match(page, /disabled=\{Boolean\(questionAction\)\}/);
  assert.match(page, /saving=\{questionAction === "save"\}/);
});

test("import writes are abortable, locked, and recover through finally blocks", async () => {
  const page = await read("app/questions/page.tsx");
  const importFlow = page.match(/const storeSource[\s\S]*?const startAiReviewAction/)?.[0] || "";

  assert.match(page, /const importActionRef\s*=\s*useRef<string \| null>\(null\)/);
  assert.match(page, /const reviewSaveRequest\s*=\s*useRef<AbortController \| null>\(null\)/);
  assert.match(importFlow, /requestJson/);
  assert.match(importFlow, /reviewSaveRequest\.current\?\.abort\(\)/);
  assert.match(importFlow, /signal: controller\.signal/);
  assert.match(importFlow, /importRevision\.current === revision/);
  assert.match(importFlow, /importRevision\.current \+= 1/);
  assert.match(importFlow, /queueRunningRef\.current/);
  assert.match(importFlow, /finally\s*\{\s*finishImportAction\(action\)/);
  assert.doesNotMatch(importFlow, /\bfetch\s*\(/);
  assert.match(page, /disabled=\{Boolean\(importAction\)\}/);
});

test("answer content requests cancel stale work and preserve login recovery", async () => {
  const page = await read("app/questions/page.tsx");
  const contentFlow = page.match(/const loadQuestionContent[\s\S]*?const select =/)?.[0] || "";

  assert.match(page, /questionContentRequests\s*=\s*useRef<Map<number, AbortController>>\(new Map\(\)\)/);
  assert.match(contentFlow, /requestJson/);
  assert.match(contentFlow, /signal: controller\.signal/);
  assert.match(contentFlow, /reason instanceof HttpError && reason\.status === 401/);
  assert.match(contentFlow, /controller\.signal\.aborted/);
  assert.match(contentFlow, /questionContentRequests\.current\.delete\(id\)/);
  assert.doesNotMatch(contentFlow, /\bfetch\s*\(/);
});
