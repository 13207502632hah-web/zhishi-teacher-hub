import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("finance is fully consolidated into the V2 teacher workspace", async () => {
  const [workspace, navigation] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/components/navigation.ts"),
  ]);

  assert.match(navigation, /href:\s*"\/v2\/modules\/finance"/);
  assert.match(workspace, /FinanceWorkspaceV2/);
  for (const label of ["应收", "实收", "待收", "异常核对", "月度课时核对", "正式课时账目", "规则来源", "异常依据"]) {
    assert.match(workspace, new RegExp(label));
  }
  for (const endpoint of ["monthly", "export", "approvals", "receipts"]) {
    assert.match(workspace, new RegExp(`/api/v2/finance/${endpoint}`));
  }
  await assert.rejects(access(new URL("../app/finance/page.tsx", import.meta.url)));
});

test("V2 finance never invents missing monthly amounts and keeps formal writes behind approval", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const label of ["待生成", "不会用 0 代替", "调整金额必须是有效数字", "实收金额必须是非负数字", "批准前不会写入正式账目", "批准时仍会重新校验"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /Number\.isFinite\(adjustment\)/);
  assert.match(workspace, /Number\.isFinite\(receivedAmount\)/);
  assert.match(workspace, /preview\.items/);
  assert.match(workspace, /\/v2\/approvals/);
  assert.match(workspace, /trim\(\), receivedAmount = Number\(value\)/);
  assert.doesNotMatch(workspace, /Number\(fields\.adjustment \|\| 0\)/);
});

test("V2 finance exposes versioned monthly, export and supporting contracts", async () => {
  const paths = ["monthly", "export", "exceptions", "context", "packages"];
  const routes = await Promise.all(paths.map((name) => read(`app/api/v2/finance/${name}/route.ts`)));

  for (let index = 0; index < paths.length; index += 1) {
    assert.match(routes[index], /export async function GET/);
    assert.doesNotMatch(routes[index], /^export \{/m);
  }
  const monthly = await read("app/api/v2/finance/monthly/route.ts");
  const exported = await read("app/api/v2/finance/export/route.ts");
  assert.match(monthly, /monthlyFinance/);
  assert.match(monthly, /requirePermission\("analytics:read"\)/);
  assert.match(exported, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(exported, /audit\(access,"export"/);
  assert.doesNotMatch(routes[4], /export async function POST|package_ledger|UPDATE lesson_packages/);
  for (const path of ["route.ts", "context/route.ts", "exceptions/route.ts", "export/route.ts", "monthly/route.ts", "packages/route.ts"]) await assert.rejects(access(new URL(`../app/api/finance/${path}`, import.meta.url)));
});

test("finance confirmation proves the server-side evidence and atomic-write boundary", async () => {
  const [route, approval, receipt, confirm, preview, executor] = await Promise.all([
    read("app/api/v2/finance/route.ts"),
    read("app/api/v2/finance/approvals/route.ts"),
    read("app/api/v2/finance/receipts/route.ts"),
    read("app/lib/finance-confirm.ts"),
    read("app/lib/finance-preview.ts"),
    read("app/lib/v2/approval-executor.ts"),
  ]);

  for (const marker of ["resolvePricingContext", "calculateLessonFinance", "previewFingerprint", "createApproval", "finance.confirm"]) {
    assert.match(approval, new RegExp(marker.replace(".", "\\.")));
  }
  assert.match(receipt, /finance\.receive/);
  assert.match(executor, /fingerprint !== String\(payload\.fingerprint/);
  assert.match(executor, /approval\.actionType === "finance\.receive"/);
  assert.match(confirm, /env\.DB\.batch/);
  assert.match(confirm, /confirmed_at IS NULL/);
  assert.match(confirm, /beginOperation/);
  assert.match(confirm, /completeOperation/);
  assert.match(preview, /payload\.exp <= Date\.now\(\)/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|confirmFinanceSettlement|received_amount=\?/);
  assert.match(approval, /requirePermission\("analytics:write"\)/);
  assert.match(receipt, /requirePermission\("analytics:write"\)/);
});

test("finance tables and controls remain usable on phones", async () => {
  const css = await read("app/v2/v2.css");

  assert.match(css, /\.v2-finance-monthly \.v2-table[^}]*overflow-x:auto/);
  assert.match(css, /\.v2-finance-monthly \.v2-table table[^}]*min-width:820px/);
  assert.match(css, /@media\(max-width:720px\)[^{]*\{\.v2-finance-monthly/);
  assert.match(css, /\.v2-finance-monthly \.v2-detail-actions>\*\{[^}]*min-height:44px/);
  assert.match(css, /\.v2-finance-confirm \.v2-form button\{[^}]*min-height:44px/);
});
