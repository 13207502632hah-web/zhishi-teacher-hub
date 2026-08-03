import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("reflections page separates list, detail, editor, actions, strategies and AI drafts", async () => {
  const page = await read("app/reflections/page.tsx");

  for (const label of ["反思列表", "反思详情", "创建 / 编辑", "改进动作", "可复用策略", "AI 反思草稿"]) {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const state of ["reflectionLoading", "reflectionLoadError", "detailLoadError", "editorError", "aiError", "重新读取反思", "重试加载详情", "role=\"alert\""]) {
    assert.match(page, new RegExp(state));
  }
  assert.match(page, /import styles from ["']\.\/reflections\.module\.css["']/);
  assert.match(page, /requestJson/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("reflection mutations and AI generation prevent duplicate submission", async () => {
  const page = await read("app/reflections/page.tsx");

  assert.match(page, /if \(mutationBusy\) return/);
  assert.match(page, /if \(aiBusy\) return/);
  assert.match(page, /disabled=\{mutationBusy\}/);
  assert.match(page, /disabled=\{aiBusy/);
  assert.match(page, /setMutationBusy\(true\)/);
  assert.match(page, /finally[\s\S]*setMutationBusy\(false\)/);
  assert.match(page, /window\.confirm\(/);
  assert.match(page, /删除后不可恢复/);
});

test("AI output remains a separate draft and never overwrites teacher text automatically", async () => {
  const page = await read("app/reflections/page.tsx");
  const generation = between(page, "const generateAiReflection", "const applyAiDraft");

  assert.match(page, /aiDraft/);
  assert.match(page, /草稿尚未保存/);
  assert.match(page, /采用草稿/);
  assert.match(page, /丢弃草稿/);
  assert.match(page, /sentFields/);
  assert.match(page, /excludedFields/);
  assert.match(page, /隐私确认/);
  assert.match(page, /字段排除/);
  assert.match(page, /费用边界/);
  assert.doesNotMatch(generation, /setForm\(/);
  assert.match(page, /if \(!String\(form\[key\] \|\| \"\"\)\.trim\(\)\)/);
  assert.match(page, /AI 草稿不会自动保存、发布或覆盖教师文字/);
});

test("reflection dialog traps focus, handles Escape and protects unsaved work", async () => {
  const page = await read("app/reflections/page.tsx");

  for (const marker of ["useRef", "previousFocusRef", "dialogRef", "beforeunload", "event.key === \"Escape\"", "event.key === \"Tab\"", "previousFocusRef.current?.focus", "tabIndex={-1}", "formDirty"]) {
    assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(page, /aria-modal=\"true\"/);
  assert.match(page, /aria-describedby=/);
  assert.match(page, /未保存/);
});

test("promoting a reflection uses the existing resources API and requires evidence", async () => {
  const [page, reflectionIdRoute] = await Promise.all([
    read("app/reflections/page.tsx"),
    read("app/api/reflections/[id]/route.ts"),
  ]);

  assert.match(page, /\/api\/resources/);
  assert.match(page, /sourceRef/);
  assert.match(page, /visibility:\s*["']private["']/);
  assert.match(page, /至少记录有效做法、改进动作或可复用素材后才能沉淀/);
  assert.match(page, /教师明确选择/);
  assert.doesNotMatch(reflectionIdRoute, /insert\(resources\)/);
  assert.doesNotMatch(reflectionIdRoute, /export async function POST/);
  assert.match(reflectionIdRoute, /export async function GET/);
});

test("reflection APIs validate records, return JSON errors and protect lesson access", async () => {
  const [listRoute, idRoute, aiRoute] = await Promise.all([
    read("app/api/reflections/route.ts"),
    read("app/api/reflections/[id]/route.ts"),
    read("app/api/ai/reflection-drafts/route.ts"),
  ]);

  for (const route of [listRoute, idRoute]) {
    assert.match(route, /try\s*\{/);
    assert.match(route, /request\.json\(\)/);
    assert.match(route, /(?:status:\s*)?\b400\b/);
    assert.match(route, /Response\.json\(\{\s*error/);
    assert.match(route, /requireLessonAccess/);
  }
  assert.match(idRoute, /(?:status:\s*)?\b404\b/);
  assert.match(listRoute, /student_evidence/);
  assert.match(idRoute, /resources\s+WHERE\s+source_ref|source_ref/);
  assert.match(aiRoute, /sanitizeForAi/);
  assert.match(aiRoute, /学生姓名和联系方式/);
  assert.match(aiRoute, /附件与登录、会话和密钥数据/);
  assert.doesNotMatch(aiRoute, /INSERT INTO reflections/);
});

test("reflection module is mobile-first, readable and touch-safe", async () => {
  const [page, css] = await Promise.all([
    read("app/reflections/page.tsx"),
    read("app/reflections/reflections.module.css"),
  ]);

  assert.match(page, /styles\./);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*48rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*90rem\)/);
  assert.doesNotMatch(page, /className="reflection/);
});
