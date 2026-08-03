import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("resource search is explicit and uses the resilient request client", async () => {
  const page = await read("app/resources/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.doesNotMatch(page, /fetch\(\s*["`]\/api\/resources/);
  assert.match(page, /appliedQuery|submittedQuery/);
  assert.match(page, /onSubmit/);
  assert.match(page, /event\.key\s*!==?\s*["`]Enter["`]/);
  assert.doesNotMatch(page, /useEffect\(\(\)\s*=>\s*\{[\s\S]*load[\s\S]*\},\s*\[load\]\)/);
});

test("resource center distinguishes loading, empty, permission and server failures", async () => {
  const page = await read("app/resources/page.tsx");

  for (const label of ["正在读取公开资源", "暂无公开资源", "还没有个人资源", "资源中心权限不足", "资源中心暂时无法读取", "重新读取"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /role=["`]alert["`]/);
  assert.match(page, /role=["`]status["`]/);
  assert.match(page, /listStatus\s*===\s*["`]permission["`]/);
  assert.match(page, /listStatus\s*===\s*["`]error["`]/);
});

test("resource mutations are guarded, recoverable and preserve audit semantics", async () => {
  const page = await read("app/resources/page.tsx");

  assert.match(page, /saving/);
  assert.match(page, /deleting/);
  assert.match(page, /disabled=\{[^}]*saving/);
  assert.match(page, /disabled=\{[^}]*deleting/);
  assert.match(page, /危险操作/);
  assert.match(page, /删除失败/);
  assert.match(page, /保存失败/);
  assert.match(page, /requestJson[\s\S]*\/api\/audit/);
  assert.match(page, /审计记录失败/);
  assert.match(page, /window\.print\(\)/);
  assert.ok(page.indexOf("/api/audit") < page.indexOf("window.print"), "audit must complete before printing");
});

test("resource dialog protects focus, escape, unsaved content and public visibility boundaries", async () => {
  const page = await read("app/resources/page.tsx");

  assert.match(page, /role=["`]dialog["`]/);
  assert.match(page, /aria-modal=["`]true["`]/);
  assert.match(page, /document\.activeElement/);
  assert.match(page, /previousFocus/);
  assert.match(page, /querySelectorAll/);
  assert.match(page, /event\.key\s*!==\s*["`]Tab["`]/);
  assert.match(page, /event\.key\s*===\s*["`]Escape["`]/);
  assert.match(page, /beforeunload/);
  assert.match(page, /有未保存修改/);
  assert.match(page, /学生、家长或私人教学信息/);
  assert.match(page, /仅教师与助教/);
});

test("external resource links are protocol-safe and keep new-tab isolation", async () => {
  const [page, api] = await Promise.all([read("app/resources/page.tsx"), read("app/api/resources/route.ts")]);

  assert.match(page, /new URL/);
  assert.match(page, /protocol/);
  assert.match(page, /https?:/);
  assert.match(page, /target=["`]\_blank["`]/);
  assert.match(page, /rel=["`]noopener noreferrer["`]/);
  assert.doesNotMatch(page, /rel=["`]noreferrer["`]/);
  assert.match(api, /protocol/);
  assert.match(api, /https?/);
  assert.match(api, /不支持的外部链接协议/);
});

test("resource page is isolated in a responsive CSS module", async () => {
  const [page, css] = await Promise.all([read("app/resources/page.tsx"), read("app/resources/resources.module.css")]);

  assert.match(page, /resources\.module\.css/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*(?:44px|2\.75rem)/);
  assert.match(css, /@media\s*\(min-width:\s*48rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*90rem\)/);
  assert.doesNotMatch(page, /className="(resourceWelcome|workflowGuide|toolbar|resourceGrid|resourceCard|modalBackdrop)/);
});

test("resource API reports destructive misses instead of pretending success", async () => {
  const api = await read("app/api/resources/[id]/route.ts");

  assert.match(api, /returning/);
  assert.match(api, /status:\s*404/);
  assert.match(api, /资源不存在/);
});
