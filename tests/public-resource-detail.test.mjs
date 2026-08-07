import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public resource detail is a client page backed by the detail API", async () => {
  const page = await read("app/resources/[id]/page.tsx");

  assert.match(page, /"use client"/);
  assert.match(page, /useParams/);
  assert.match(page, /requestJson<DetailPayload>\(`\/api\/resources\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(page, /AbortController/);
  assert.match(page, /HttpError/);
  assert.match(page, /retryKey/);
});

test("resource detail page separates loading, missing, error and ready states", async () => {
  const page = await read("app/resources/[id]/page.tsx");

  for (const label of ["正在读取资源详情", "该资源不存在或未公开", "资源详情暂时无法读取", "重新读取", "返回公开资源中心"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /status\s*===\s*["`]loading["`]/);
  assert.match(page, /status\s*===\s*["`]missing["`]/);
  assert.match(page, /status\s*===\s*["`]error["`]/);
  assert.match(page, /status\s*===\s*["`]ready["`]/);
  assert.match(page, /role=["`]status["`]/);
  assert.match(page, /role=["`]alert["`]/);
});

test("detail page keeps public boundary copy and private visibility explicit", async () => {
  const page = await read("app/resources/[id]/page.tsx");

  assert.match(page, /私有资源仅教师与助教可见/);
  assert.match(page, /仅教师与助教/);
  assert.match(page, /教师已完成公开检查/);
  assert.match(page, /不含学生、家长或私人教学信息/);
  assert.match(page, /visibility\s*===\s*["`]public["`]/);
});

test("detail page only opens safe external links in isolated tabs", async () => {
  const page = await read("app/resources/[id]/page.tsx");

  assert.match(page, /safeProtocols\s*=\s*\[["`]http:["`],\s*["`]https:["`]\]/);
  assert.match(page, /new URL/);
  assert.match(page, /protocol/);
  assert.match(page, /target=["`]_blank["`]/);
  assert.match(page, /rel=["`]noopener noreferrer["`]/);
  assert.match(page, /链接未显示：仅支持 http:\/\/ 或 https:\/\/ 安全协议/);
});

test("detail page supports share-link copy and clear return action", async () => {
  const page = await read("app/resources/[id]/page.tsx");

  assert.match(page, /navigator\.clipboard\.writeText\(window\.location\.href\)/);
  assert.match(page, /已复制分享链接/);
  assert.match(page, /复制分享链接/);
  assert.match(page, /href=["`]\/resources["`]/);
});

test("resource detail styles are mobile-first, touch-safe and focus-visible", async () => {
  const [page, css] = await Promise.all([read("app/resources/[id]/page.tsx"), read("app/resources/resource-detail.module.css")]);

  assert.match(page, /resource-detail\.module\.css/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*(?:44px|2\.75rem)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(min-width:\s*48rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
});

test("AppShell treats every public resource detail route as a public page", async () => {
  const shell = await read("app/components/AppShell.tsx");

  assert.match(shell, /\/resources\\\/\\d\+\$\/\.test\(pathname\)/);
});

test("home and resource list link into resource detail pages", async () => {
  const [home, list] = await Promise.all([read("app/page.tsx"), read("app/resources/page.tsx")]);

  assert.match(home, /\/resources\/\$\{item\.id\}/);
  assert.match(list, /\/resources\/\$\{item\.id\}/);
  assert.match(list, /查看详情/);
});

test("detail API lets anonymous users read only public resources and keeps DELETE private", async () => {
  const api = await read("app/api/resources/[id]/route.ts");

  assert.match(api, /export async function GET/);
  assert.match(api, /resources:private/);
  assert.match(api, /eq\(resources\.visibility,\s*["`]public["`]\)/);
  assert.match(api, /status:\s*404/);
  assert.match(api, /资源不存在或未公开/);
  assert.match(api, /canManage/);
  assert.match(api, /requirePermission\(["`]resources:write["`]\)/);
});
