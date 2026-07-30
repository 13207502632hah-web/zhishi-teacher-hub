import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("calendar subscription loads active state through the resilient client", async () => {
  const page = await read("app/calendar/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /subscriptionLoadError/);
  assert.match(page, /重新读取订阅状态/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /\.json\(\)/);
});

test("calendar rotation cannot overlap and only existing subscriptions need warning", async () => {
  const page = await read("app/calendar/page.tsx");

  assert.match(page, /busyAction/);
  assert.match(page, /if \(busy\) return/);
  assert.match(page, /hasActiveSubscription/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /finally\s*\{\s*setBusyAction\(""\)/);
  assert.match(page, /disabled=\{busy/);
});

test("calendar protects the one-time address and handles clipboard failure honestly", async () => {
  const page = await read("app/calendar/page.tsx");

  assert.match(page, /addressSaved/);
  assert.match(page, /beforeunload/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /请手动选择并复制/);
  assert.match(page, /webcal:/);
  assert.match(page, /download=/);
  assert.match(page, /下载的是当前快照/);
});

test("calendar token rotation is atomic before returning the new private address", async () => {
  const route = await read("app/api/calendar/subscription/route.ts");

  assert.match(route, /env\.DB\.batch/);
  assert.match(route, /UPDATE calendar_subscriptions SET revoked_at/);
  assert.match(route, /INSERT INTO calendar_subscriptions/);
  assert.match(route, /token,\s*path:/);
  assert.ok(
    route.indexOf("env.DB.batch") < route.lastIndexOf("return Response.json("),
    "the atomic rotation must finish before returning the new token",
  );
});

test("calendar uses shared primitives and readable mobile-first styles", async () => {
  const [layout, page, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/calendar/page.tsx"),
    read("app/calendar.css"),
  ]);

  assert.match(layout, /import "\.\/calendar\.css"/);
  for (const component of ["Panel", "StatusBadge"]) {
    assert.match(page, new RegExp(component));
  }
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
