import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("portal page uses the resilient JSON client and recoverable request states", async () => {
  const page = await read("app/portal/page.tsx");

  assert.match(page, /portal\.module\.css/);
  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /portalLoadError/);
  assert.match(page, /sessionExpired/);
  assert.match(page, /重新读取门户/);
  assert.match(page, /role=\{alert \? "alert" : "status"\}/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("portal distinguishes learner views and every binding/session state", async () => {
  const page = await read("app/portal/page.tsx");

  for (const state of ["unbound", "pending", "disabled", "expired"]) assert.match(page, new RegExp(state));
  assert.match(page, /role === "parent"/);
  assert.match(page, /学生视角/);
  assert.match(page, /家长视角/);
  assert.match(page, /现在要做什么/);
  assert.match(page, /bindingStatus/);
});

test("portal prioritizes actionable homework without exposing private teacher fields", async () => {
  const page = await read("app/portal/page.tsx");

  for (const token of ["needsAction", "revision", "dueAt", "feedbackStatus", "score", "指定文件"]) assert.match(page, new RegExp(token));
  assert.doesNotMatch(page, /guardianContact|teacherNote|internalNote/);
  assert.doesNotMatch(page, /item\.url\b/);
});

test("portal styles are module-scoped, mobile-first, readable and touch-safe", async () => {
  const css = await read("app/portal/portal.module.css");

  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*80rem\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("portal API scopes records to active authorized students and published assignments", async () => {
  const route = await read("app/api/portal/route.ts");

  assert.match(route, /requirePermission\("portal:read"\)/);
  assert.match(route, /status='active'/);
  assert.match(route, /a\.status='published'/);
  assert.match(route, /assignment_targets/);
  assert.match(route, /a\.status='published'[\s\S]+?\.bind\(\.\.\.ids\)\.all/);
  assert.match(route, /feedback/);
  assert.match(route, /resources/);
  assert.doesNotMatch(route, /studentId.*searchParams|searchParams.*studentId/);
});

test("portal API only returns confirmed and permitted feedback, selected resource metadata, and protected file links", async () => {
  const route = await read("app/api/portal/route.ts");

  assert.match(route, /f\.status='confirmed'/);
  assert.match(route, /f\.sent_at\s+IS\s+NOT\s+NULL/);
  assert.match(route, /audience/);
  assert.match(route, /visibility='public'/);
  assert.match(route, /attachment/);
  assert.match(route, /fileId/);
  assert.match(route, /env\.FILES\.get/);
  const responseSection = route.slice(route.lastIndexOf("return json"));
  assert.doesNotMatch(responseSection, /storageKey|storage_key/);
  assert.doesNotMatch(route, /guardian_contact|teacher_note|reflection_outline/);
});

test("portal API exposes distinct binding state without turning a missing session into empty data", async () => {
  const route = await read("app/api/portal/route.ts");

  for (const state of ["unbound", "pending", "disabled"]) assert.match(route, new RegExp(state));
  assert.match(route, /403/);
  assert.match(route, /Cache-Control/);
  const page = await read("app/portal/page.tsx");
  assert.match(page, /status === 401/);
});
