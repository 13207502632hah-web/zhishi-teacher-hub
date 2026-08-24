import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("calendar subscription loads active state through the resilient client", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /json\("\/api\/v2\/calendar\/subscription"/);
  assert.match(page, /setSubscription/);
  assert.match(page, /教学运营数据暂时无法读取/);
});

test("calendar rotation cannot overlap and only existing subscriptions need warning", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /rotationArmed/);
  assert.match(page, /setRotationArmed\(true\)/);
  assert.match(page, /停用旧地址并生成新地址/);
  assert.match(page, /finally\s*\{\s*setBusy\(false\)/);
  assert.match(page, /disabled=\{busy/);
});

test("calendar protects the one-time address and handles clipboard failure honestly", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");

  assert.match(page, /addressSaved/);
  assert.match(page, /beforeunload/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /请手动选择并复制/);
  assert.match(page, /webcal:/);
  assert.match(page, /download="知师研室课程日历\.ics"/);
  assert.match(page, /下载的只是当前快照/);
});

test("calendar token rotation is atomic before returning the new private address", async () => {
  const route = await read("app/api/v2/calendar/subscription/route.ts");

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
  const [page, workspace, css] = await Promise.all([read("app/v2/operations/page.tsx"), read("app/v2/operations/OperationsWorkspace.tsx"), read("app/v2/v2.css")]);
  assert.match(page, /initialTab/);
  assert.match(workspace, /Apple 日历订阅/);
  assert.match(workspace, /添加已订阅的日历/);
  assert.match(css, /v2-calendar-address/);
  assert.match(css, /@media\(max-width:720px\)/);
});
