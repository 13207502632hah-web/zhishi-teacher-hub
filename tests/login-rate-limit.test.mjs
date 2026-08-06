import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("login rate limiting trusts only the Cloudflare-provided client IP", async () => {
  const route = await read("app/api/auth/login/route.ts");

  assert.match(route, /cf-connecting-ip/);
  assert.doesNotMatch(route, /x-forwarded-for/);
  assert.match(route, /\|\| "unknown"/);
  assert.match(route, /recordLoginFailure/);
  assert.match(route, /clearLoginFailures/);
});
