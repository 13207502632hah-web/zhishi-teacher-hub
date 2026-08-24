import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("app/v2/settings/SettingsWorkspace.tsx");
const account = read("app/v2/account/AccountWorkspace.tsx");
const settingsApi = read("app/api/v2/settings/route.ts");
const aiApi = read("app/api/v2/settings/ai/route.ts");
const aiServer = read("app/lib/ai/server.ts");
const dataApi = read("app/api/v2/settings/data/route.ts");
const exportApi = read("app/api/v2/settings/export/route.ts");
const demoApi = read("app/api/v2/settings/demo/route.ts");
const passwordApi = read("app/api/auth/change-password/route.ts");

test("V2 settings consolidates members, mini bindings, AI, audit, backup and data controls", () => {
  for (const heading of ["成员与权限", "小程序绑定", "AI 与模型", "审计记录", "备份与数据", "完整数据备份", "合成演示数据", "永久删除全部教学数据"]) assert.match(page, new RegExp(heading));
  for (const endpoint of ["/api/v2/settings", "/api/v2/settings/ai", "/api/v2/settings/demo", "/api/v2/settings/export", "/api/v2/settings/data"]) assert.match(page, new RegExp(endpoint));
  assert.equal(fs.existsSync(path.join(root, "app/settings/page.tsx")), false, "obsolete settings page must be removed");
  assert.equal(fs.existsSync(path.join(root, "app/api/settings/route.ts")), false, "obsolete settings API must be removed");
});

test("settings actions have explicit duplicate-submit guards and retryable states", () => {
  for (const action of ["saveMember", "disableMember", "saveScope", "saveAi", "clearLearning", "seedDemo", "clearDemo", "exportData", "deleteAllData"]) assert.match(page, new RegExp(action));
  assert.match(page, /busyKey/);
  assert.match(page, /disabled=/);
  assert.match(page, /loading|正在/);
  assert.match(page, /error|失败/);
  assert.match(page, /刷新设置/);
});

test("data export warns about student information and remains audited", () => {
  assert.match(page, /学生姓名、评价和联系方式/);
  assert.match(page, /Blob/);
  assert.match(page, /下载 JSON 备份/);
  assert.match(exportApi, /audit\(/);
});

test("delete-all and demo cleanup require exact phrases plus a second confirmation", () => {
  assert.match(dataApi, /confirmation\s*!==\s*["']删除全部教学数据["']/);
  assert.match(page, /deleteConfirmation\s*!==\s*["']删除全部教学数据["']/);
  assert.match(page, /demoConfirmation\s*!==\s*["']清除演示数据["']/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /不可恢复的永久删除/);
  assert.match(demoApi, /demo_records/);
  assert.match(demoApi, /DELETE FROM demo_records/);
  assert.match(demoApi, /UPDATE lesson_finance SET pricing_rule_id=NULL/);
  assert.match(page, /真实教学数据不受影响/);
});

test("AI controls preserve privacy settings, remove cost limits and retain only a technical burst guard", () => {
  assert.match(page, /不设置费用、调用次数或 token 上限/);
  assert.match(page, /privacyAcknowledged/);
  assert.match(page, /includeStudentName/);
  assert.match(aiApi, /body\.includeStudentName === undefined/);
  assert.doesNotMatch(aiServer, /DAILY_LIMIT/);
  assert.doesNotMatch(aiServer, /dailyLimit/);
  assert.match(aiServer, /INSERT INTO ai_runs[\s\S]+SELECT/);
  assert.match(aiServer, /AI_BURST_GUARD/);
  assert.match(aiServer, /'-60 seconds'/);
});

test("assistant scope and account disabling are checked by the server", () => {
  assert.match(settingsApi, /status\s*=\s*['"]active['"]/i);
  assert.match(settingsApi, /staff_class_access/);
  assert.match(settingsApi, /action === "disableUser"/);
  assert.match(settingsApi, /audit\([^)]*assign_class_scope/);
});

test("both teacher administrator and assistant can change their own password in V2 account", () => {
  assert.match(account, /authType === "staff"/);
  assert.match(account, /\/api\/auth\/staff-password/);
  assert.match(account, /\/api\/auth\/change-password/);
  assert.match(account, /form\.reset\(\)/);
  assert.match(account, /旧会话/);
  assert.match(passwordApi, /Cache-Control/);
});

test("V2 settings styles include responsive data controls and touch targets", () => {
  const css = read("app/v2/v2.css");
  assert.match(css, /v2-settings-data-grid/);
  assert.match(css, /v2-danger-confirm/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /@media\(max-width:720px\)/);
});
