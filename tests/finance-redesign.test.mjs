import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("finance page keeps every financial request independent and resilient", async () => {
  const page = await read("app/finance/page.tsx");

  assert.match(page, /finance\.module\.css/);
  assert.match(page, /requestJson/);
  assert.match(page, /loadFinanceList/);
  assert.match(page, /loadLessons/);
  assert.match(page, /loadMonthly/);
  assert.match(page, /retryFinance/);
  assert.match(page, /retryLessons/);
  assert.match(page, /retryMonthly/);
  assert.match(page, /AbortController/);
  assert.doesNotMatch(page, /Promise\.all\(/);
  assert.doesNotMatch(page, /\.json\(\)/);
});

test("finance page presents a reviewable settlement workflow without inferring amounts", async () => {
  const page = await read("app/finance/page.tsx");

  for (const label of ["预计", "已收", "待收", "少收", "超收", "待核对", "异常"]) assert.match(page, new RegExp(label));
  for (const label of ["规则编号", "有效期", "计算公式", "调整金额", "调整原因", "预览有效期"]) assert.match(page, new RegExp(label));
  assert.match(page, /previewToken/);
  assert.match(page, /operationId/);
  assert.match(page, /preview\?\.snapshot\?\.operationId/);
  assert.match(page, /actionBusy/);
  assert.match(page, /canConfirm/);
  assert.match(page, /导出范围/);
  assert.match(page, /formatMoney/);
  assert.doesNotMatch(page, /Number\(item\.(expected_amount|received_amount)/);
  assert.doesNotMatch(page, /Number\(adjustment\)/);
});

test("finance confirmation proves the server-side preview boundary and atomic write", async () => {
  const route = await read("app/api/finance/route.ts");
  const confirm = await read("app/lib/finance-confirm.ts");
  const preview = await read("app/lib/finance-preview.ts");

  for (const marker of ["previewToken", "expiresAt", "operationId", "calculation_snapshot"]) assert.match(route, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.match(preview, /TEACHER_ADMIN_SESSION_SECRET/);
  assert.match(route, /previewToken\.operationId !== operationId/);
  assert.match(route, /confirmFinanceSettlement/);
  assert.match(confirm, /env\.DB\.batch/);
  assert.match(confirm, /confirmed_at=\?/);
  assert.match(confirm, /confirmed_at IS NULL/);
  assert.match(confirm, /status='review'/);
  assert.match(confirm, /status !== "review"|status !== 'review'/);
  assert.match(confirm, /beginOperation/);
  assert.match(confirm, /completeOperation/);
  assert.match(confirm, /operation_replay_conflict/);
  assert.match(preview, /payload\.exp <= Date\.now\(\)/);
  assert.match(route, /request\.json\(\)\.catch/);
  assert.match(route, /parseRequiredNumber\(body\.receivedAmount/);
  assert.doesNotMatch(route, /Number\(body\.receivedAmount \|\| 0\)/);
  assert.doesNotMatch(route, /Number\(body\.adjustment \|\| 0\)/);
});

test("finance styles are local, readable, touchable and horizontally contained", async () => {
  const css = await read("app/finance/finance.module.css");

  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-(?:height|width):\s*44px/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /overflow-x:\s*(?:hidden|clip)/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)/);
});
