import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account role and student links are validated before the first write and commit atomically", async () => {
  const route = await read("app/api/settings/route.ts");
  const start = route.indexOf('if (action === "upsertUser")');
  const end = route.indexOf('if (action === "disableUser")', start);
  assert.ok(start >= 0 && end > start, "upsertUser branch must exist");

  const branch = route.slice(start, end);
  const roleLookup = branch.indexOf("SELECT id FROM roles");
  const studentLookup = branch.indexOf("SELECT id FROM students WHERE id=?");
  const firstUserWrite = branch.indexOf("INSERT INTO users");
  assert.ok(roleLookup >= 0 && roleLookup < firstUserWrite, "role must be checked before creating or reactivating an account");
  assert.ok(studentLookup >= 0 && studentLookup < firstUserWrite, "requested student links must be checked before creating or reactivating an account");
  assert.match(branch, /const statements(?::[^=]+)?\s*=\s*\[/);
  assert.match(branch, /await env\.DB\.batch\(statements\)/);
  assert.match(branch, /INSERT INTO audit_logs/);
  assert.doesNotMatch(branch, /await audit\(access,\s*"assign_role"/);
});

test("reading existing AI values during PATCH does not create a settings row before validation", async () => {
  const route = await read("app/api/settings/ai/route.ts");
  const start = route.indexOf("async function storedSettings");
  const end = route.indexOf("export async function GET", start);
  assert.ok(start >= 0 && end > start, "stored settings helper must exist");

  const helper = route.slice(start, end);
  assert.doesNotMatch(helper, /INSERT OR IGNORE INTO ai_settings/);
  assert.match(helper, /dailyLimit:\s*50/);
  assert.match(helper, /includeStudentName:\s*1/);
});
