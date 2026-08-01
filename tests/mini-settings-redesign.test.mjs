import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mini settings uses the resilient JSON client and keeps three loads independently recoverable", async () => {
  const page = await read("app/mini-settings/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /mini-settings\.module\.css/);
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.doesNotMatch(page, /response\.json\s*\(\)/);
  for (const loader of ["loadStudents", "loadBindings", "loadAccounts"]) assert.match(page, new RegExp(loader));
  for (const errorState of ["studentsError", "bindingsError", "accountsError"]) assert.match(page, new RegExp(errorState));
  for (const retryLabel of ["重新读取学生", "重新读取绑定", "重新读取账号"]) assert.match(page, new RegExp(retryLabel));
});

test("one-time invite copy names the role, student, expiry and single-display boundary", async () => {
  const [page, service] = await Promise.all([
    read("app/mini-settings/page.tsx"),
    read("app/lib/services/mini-binding-service.ts"),
  ]);

  for (const marker of ["仅显示一次", "对应学生", "有效期至", "输入后不会开放学生数据"]) assert.match(page, new RegExp(marker));
  assert.match(service, /expires_at>CURRENT_TIMESTAMP/);
  assert.match(service, /used_at IS NULL/);
  assert.match(service, /meta\??\.changes|changes/);
});

test("binding decisions require teacher confirmation, explain impact and reject duplicate transitions", async () => {
  const [page, route, service] = await Promise.all([
    read("app/mini-settings/page.tsx"),
    read("app/api/mini/bindings/[id]/route.ts"),
    read("app/lib/services/mini-binding-service.ts"),
  ]);

  for (const status of ["pending", "active", "rejected", "disabled"]) assert.match(page, new RegExp(status));
  for (const impact of ["确认后", "拒绝后", "停用后", "不能重复"]) assert.match(page, new RegExp(impact));
  assert.match(route, /requirePermission\("students:write"\)/);
  assert.match(service, /WHERE id=\? AND status=\?/);
  assert.match(service, /status: 409|status:409/);
  assert.match(service, /decision === "confirm"/);
});

test("teacher account linking and invite creation keep server-side ownership checks", async () => {
  const [accounts, invites] = await Promise.all([
    read("app/api/mini/accounts/route.ts"),
    read("app/api/mini/invites/route.ts"),
  ]);

  assert.match(accounts, /user_id/);
  assert.match(accounts, /已关联其他教师/);
  assert.doesNotMatch(accounts, /open_id|openid/i);
  assert.match(invites, /requireStudentAccess\(access, studentId\)/);
  assert.match(invites, /expiresAt/);
});

test("disabled bindings remove student access while preserving the existing session boundary", async () => {
  const [service, sync, auth] = await Promise.all([
    read("app/lib/services/mini-binding-service.ts"),
    read("app/lib/services/mini-sync-service.ts"),
    read("app/lib/mini-auth.ts"),
  ]);

  assert.match(service, /status === "disabled"/);
  assert.match(service, /disabled_at/);
  assert.match(sync, /mini_bindings WHERE account_id=\? AND status='active'/);
  assert.match(sync, /parent_student_links WHERE parent_account_id=\? AND status='active'/);
  assert.match(auth, /wa\.status='active'/);
});

test("mini settings styles are readable, touch-safe and mobile-first", async () => {
  const css = await read("app/mini-settings/mini-settings.module.css");

  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-(?:width|height):\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)/);
});

test("mini settings never renders application secrets or complete identity markers", async () => {
  const page = await read("app/mini-settings/page.tsx");

  assert.doesNotMatch(page, /AppSecret|sessionKey|session\s+key|open_id|openid|wxf[a-z0-9]+/i);
  assert.match(page, /隐私|敏感|不会显示/);
});
