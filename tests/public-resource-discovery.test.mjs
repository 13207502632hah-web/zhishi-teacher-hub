import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("resources API exposes public discovery summary and a bounded public scope", async () => {
  const api = await read("app/api/v2/resources/route.ts");

  assert.match(api, /scope/);
  assert.match(api, /limit/);
  assert.match(api, /eq\(resources\.visibility,\s*["`]public["`]\)/);
  assert.match(api, /\.limit\(limit\)/);
  assert.match(api, /publicCount/);
  assert.match(api, /popularTags/);
  assert.match(api, /visibility:\s*["`]private["`]/);
  assert.doesNotMatch(api, /body\.visibility\s*===\s*["`]public["`]/);
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

test("docs keep resources write boundary and mini-only learner access accurate", async () => {
  const [readme, architecture] = await Promise.all([
    read("README.md"),
    read("ARCHITECTURE.md"),
  ]);

  assert.match(architecture, /匿名\/公开请求只读公开资源/);
  assert.match(architecture, /新增、删除与私有范围读写要求教师或已授权助教/);
  assert.match(architecture, /学生与家长唯一业务入口/);
  assert.match(architecture, /网站不建立学生或家长会话/);
  assert.match(readme, /学生与家长仅使用微信小程序/);
  assert.match(readme, /网站只服务主教师和助教/);
  assert.doesNotMatch(readme, /`\/portal`/);
});

test("resources page surfaces the public discovery summary from the same API", async () => {
  const page = await read("app/resources/page.tsx");

  assert.match(page, /summary\?:/);
  assert.match(page, /publicSummary/);
  assert.match(page, /setPublicSummary/);
  assert.match(page, /当前公开 \{publicSummary\.publicCount/);
  assert.match(page, /publicSummary\.popularTags\?\.slice/);
});

test("popular tags aggregate across all public resources, not only current result rows", async () => {
  const api = await read("app/api/v2/resources/route.ts");

  assert.match(api, /publicTagRows/);
  assert.match(api, /\.from\(resources\)\.where\(eq\(resources\.visibility,\s*["`]public["`]\)\)/);
  assert.match(api, /Array\.from\(publicTagRows\.flatMap/);
  assert.match(api, /popularTags/);
  assert.doesNotMatch(api, /rows\.flatMap/);
});
