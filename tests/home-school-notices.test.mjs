import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("home-school notices keep drafts, publishing and per-account receipts separate", async () => {
  const [migration, schema, teacher] = await Promise.all([read("drizzle/0036_class_notices.sql"), read("db/schema.ts"), read("app/api/v2/notices/route.ts")]);
  for (const marker of ["class_notices", "notice_receipts", "audience_role", "operation_id", "read_at", "acknowledged_at", "notice_receipts_notice_account_student_unique"]) assert.match(migration, new RegExp(marker));
  assert.match(schema, /export const classNotices/); assert.match(schema, /export const noticeReceipts/);
  assert.match(teacher, /VALUES\([^\n]*'draft'/); assert.match(teacher, /created_by=\? AND operation_id=\?/); assert.match(teacher, /recipientCount/); assert.match(teacher, /acknowledgedCount/);
});

test("formal notice publication is teacher-approved and role-scoped", async () => {
  const [approval, executor, sync] = await Promise.all([read("app/api/v2/approvals/route.ts"), read("app/lib/v2/approval-executor.ts"), read("app/lib/services/mini-sync-service.ts")]);
  assert.match(approval, /class_notice\.publish/); assert.match(executor, /class_notice\.publish/); assert.match(executor, /status='published'/); assert.match(executor, /audienceRole/); assert.match(executor, /class_notice\.published/);
  assert.match(sync, /audience_role IS NULL OR audience_role=\?/);
});

test("mini notices enforce student binding and record read plus acknowledgement operations", async () => {
  const [list, receipt, page, markup, app] = await Promise.all([read("app/api/v2/mini/notices/route.ts"), read("app/api/v2/mini/notices/[id]/read/route.ts"), read("mini-program/pages/notices/index.js"), read("mini-program/pages/notices/index.wxml"), read("mini-program/app.json")]);
  assert.match(list, /accessibleStudentIds/); assert.match(list, /n\.status='published'/); assert.match(list, /n\.audience_role='both' OR n\.audience_role=\?/); assert.match(list, /private, no-store/);
  assert.match(receipt, /operationId/); assert.match(receipt, /notice_receipts/); assert.match(receipt, /COALESCE\(notice_receipts\.read_at/); assert.match(receipt, /acknowledged_at/); assert.match(receipt, /access\.role/);
  assert.match(page, /notice-read/); assert.match(page, /notice-ack/); assert.match(markup, /我已知晓/); assert.doesNotMatch(markup + page, /聊天|回复消息|发送消息/);
  assert.match(app, /pages\/notices\/index/); assert.match(app, /"text": "消息"/);
});

test("local migration and release readiness include home-school notices", async () => {
  const [initializer, automation, readiness] = await Promise.all([read("scripts/init-local-d1.mjs"), read("scripts/mini-automation.mjs"), read("scripts/mobile-readiness.mjs")]);
  assert.match(initializer, /0036_class_notices\.sql/); assert.match(automation, /0036_class_notices\.sql/); assert.match(automation, /"notice_receipts"/); assert.match(readiness, /pages\/notices\/index/);
});
