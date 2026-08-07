import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("resources API exposes public discovery summary and a bounded public scope", async () => {
  const api = await read("app/api/resources/route.ts");

  assert.match(api, /scope/);
  assert.match(api, /limit/);
  assert.match(api, /eq\(resources\.visibility,\s*["`]public["`]\)/);
  assert.match(api, /\.limit\(limit\)/);
  assert.match(api, /publicCount/);
  assert.match(api, /popularTags/);
  assert.match(api, /visibility\s*===\s*["`]public["`]/);
});

test("public home renders a real resource preview backed by the public API", async () => {
  const page = await read("app/page.tsx");

  assert.match(page, /scope=public&limit=3/);
  assert.match(page, /publicHomeResourcePreview/);
  assert.match(page, /publicHomeResourceCard/);
  assert.match(page, /publicHomeResourceEmpty/);
  assert.match(page, /当前公开/);
  assert.match(page, /热门标签/);
  assert.match(page, /进入公开资源中心/);
});

test("public home preview styles are mobile-first with desktop enhancement", async () => {
  const css = await read("app/public-entry.css");

  assert.match(css, /\.publicHomeResourcePreview/);
  assert.match(css, /\.publicHomeResourceCard/);
  assert.match(css, /min-width:\s*24rem/);
  assert.match(css, /@media\s*\(min-width:\s*48rem\)/);
});

test("docs keep resources write boundary and portal access implementation accurate", async () => {
  const [readme, architecture] = await Promise.all([
    read("README.md"),
    read("ARCHITECTURE.md"),
  ]);

  assert.match(architecture, /匿名\/公开请求只读公开资源/);
  assert.match(architecture, /新增、删除与私有范围读写要求教师或已授权助教/);
  assert.match(architecture, /门户页面与 API 暂按教师管理员登录保护/);
  assert.match(readme, /当前实现说明/);
  assert.match(readme, /登录链路尚未开放/);
});

test("resources page surfaces the public discovery summary from the same API", async () => {
  const page = await read("app/resources/page.tsx");

  assert.match(page, /summary\?:/);
  assert.match(page, /publicSummary/);
  assert.match(page, /setPublicSummary/);
  assert.match(page, /当前公开 \{publicSummary\.publicCount/);
  assert.match(page, /publicSummary\.popularTags\?\.slice/);
});
