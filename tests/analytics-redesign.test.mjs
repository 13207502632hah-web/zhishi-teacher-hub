import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("analytics loading uses requestJson, explicit filters, timeout, and abort", async () => {
  const page = await read("app/analytics/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /loadRequest\.current\?\.abort\(\)/);
  assert.match(page, /timeoutMs:\s*15_000/);
  assert.match(page, /draftRange/);
  assert.match(page, /appliedRange/);
  assert.match(page, /applyFilters/);
  assert.match(page, /应用筛选/);
  assert.match(page, /重置筛选/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("analytics distinguishes loading, empty, permission, server, and retry states", async () => {
  const page = await read("app/analytics/page.tsx");

  for (const state of ["loading", "empty", "permission", "server-error"]) {
    assert.match(page, new RegExp(`['\"]${state}['\"]`));
  }
  assert.match(page, /reason\.status\s*===\s*401/);
  assert.match(page, /reason\.status\s*===\s*403/);
  assert.match(page, /reason\.status\s*>=\s*500/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
  assert.match(page, /重新读取/);
});

test("analytics modules expose evidence and never turn insufficient values into conclusions", async () => {
  const page = await read("app/analytics/page.tsx");

  for (const label of ["教学效率", "学生学习", "题库覆盖", "作业趋势", "教师成长", "统计范围", "数据来源", "数据不足"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /分母/);
  assert.match(page, /formatPercentage|formatRate/);
  assert.match(page, /formatAverage/);
  assert.match(page, /formatDate/);
  assert.doesNotMatch(page, /\|\|\s*0/);
});

test("analytics trends remain readable without relying on color alone", async () => {
  const page = await read("app/analytics/page.tsx");

  assert.match(page, /<ol/);
  assert.match(page, /参与度/);
  assert.match(page, /理解度/);
  assert.match(page, /已完成/);
  assert.match(page, /至少两个日期/);
  assert.match(page, /aria-label/);
  assert.doesNotMatch(page, /style=\{\{\s*height:/);
});

test("analytics API does not count unscored assessment rows as evidence", async () => {
  const route = await read("app/api/analytics/route.ts");

  assert.match(route, /requirePermission\("analytics:read"\)/);
  assert.match(route, /COUNT\(r\.score\)\s+AS total/);
  assert.doesNotMatch(route, /COUNT\(\*\)\s+AS total FROM assessment_results/);
  assert.doesNotMatch(route, /Number\(row\(4\)\.average\s*\|\|\s*0\)/);
});

test("analytics styles are module-scoped, readable, touch-safe, responsive, and printable", async () => {
  const [page, css] = await Promise.all([
    read("app/analytics/page.tsx"),
    read("app/analytics/analytics.module.css"),
  ]);

  assert.match(page, /analytics\.module\.css/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*print/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.filterActions button\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(css, /\.filterActions\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
