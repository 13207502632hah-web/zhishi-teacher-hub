import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readService = () => readFile(new URL("../app/lib/services/mini-binding-service.ts", import.meta.url), "utf8");

test("claiming an invite, creating its binding and emitting sync commit in one batch", async () => {
  const service = await readService();
  const start = service.indexOf("export async function requestMiniBinding");
  const end = service.indexOf("export async function listBindingRequests", start);
  const flow = service.slice(start, end);

  assert.match(flow, /const statements(?::[^=]+)?\s*=\s*\[/);
  assert.match(flow, /UPDATE mini_invites SET used_at=CURRENT_TIMESTAMP/);
  assert.match(flow, /INSERT INTO mini_bindings/);
  assert.match(flow, /INSERT INTO sync_events/);
  assert.match(flow, /const results\s*=\s*await env\.DB\.batch\(statements\)/);
  assert.match(flow, /results\[[^\]]+\][\s\S]*?meta\?\.changes/);
  assert.doesNotMatch(flow, /const consumed\s*=\s*await[\s\S]*?\.run\(\)/);
  assert.doesNotMatch(flow, /await recordSyncEvent/);
});

test("a binding decision and every account, parent and sync side effect commit atomically", async () => {
  const service = await readService();
  const start = service.indexOf("export async function decideBinding");
  const flow = service.slice(start);

  assert.match(flow, /const statements(?::[^=]+)?\s*=\s*\[/);
  assert.match(flow, /UPDATE wechat_accounts/);
  assert.match(flow, /parent_student_links/);
  assert.match(flow, /INSERT INTO sync_events/);
  assert.match(flow, /const results\s*=\s*await env\.DB\.batch\(statements\)/);
  assert.match(flow, /WHERE id=\? AND status=\?/);
  assert.doesNotMatch(flow, /await recordSyncEvent/);
});
