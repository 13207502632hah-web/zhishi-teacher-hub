import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public home is a teacher-first entry instead of a duplicate resource page", async () => {
  const page = await read("app/page.tsx");

  assert.doesNotMatch(page, /import ResourcesPage/);
  assert.doesNotMatch(page, /return <ResourcesPage/);
  assert.match(page, /教师登录/);
  assert.match(page, /浏览公开资源/);
  assert.match(page, /备课/);
  assert.match(page, /上课/);
  assert.match(page, /作业/);
  assert.match(page, /反馈/);
  assert.match(page, /结算/);
  assert.ok(page.indexOf("教师登录") < page.indexOf("浏览公开资源"));
});

test("teacher login accepts account names and uses the resilient request client", async () => {
  const page = await read("app/teacher-login/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.doesNotMatch(page, /response\.json\(\)/);
  assert.doesNotMatch(page, /inputMode="numeric"/);
  assert.match(page, /autoComplete="username"/);
  assert.match(page, /aria-describedby/);
});

test("public entry styles are mobile-first, readable and use standard desktop enhancement", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/public-entry.css"),
  ]);

  assert.match(layout, /import "\.\/public-entry\.css"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
