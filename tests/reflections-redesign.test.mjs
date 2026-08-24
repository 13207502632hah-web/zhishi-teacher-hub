import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("reflections are fully consolidated into the V2 learning workspace", async () => {
  const [workspace, navigation] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/components/navigation.ts"),
  ]);

  assert.match(workspace, /function ReflectionWorkspace/);
  assert.match(workspace, /view === "reflections"/);
  assert.match(navigation, /href:\s*"\/v2\/modules\/learning\?view=reflections"/);
  await assert.rejects(access(new URL("../app/reflections/page.tsx", import.meta.url)));
});

test("reflection workspace keeps searchable list, calendar, detail, actions and strategies", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const label of ["全文搜索", "主题标签", "全部问题类型", "列表", "日历", "反思详情", "完成行动", "沉淀为策略", "完整内容默认私密"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /<ClassPicker[^>]+includeAll/);
  assert.match(workspace, /endpoint="\/api\/v2\/classes\/options"/);
  assert.match(workspace, /URLSearchParams/);
  assert.match(workspace, /\/api\/v2\/reflections/);
  assert.match(workspace, /\/api\/v2\/reflections\/\$\{row\.id\}/);
  assert.match(workspace, /calendar\.offset/);
  assert.match(workspace, /永久删除这条私密反思/);
});

test("reflection editor is complete, single-submit, focus-trapped and protects unsaved work", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const field of ["expectedVsActual", "effectivePractices", "difficulties", "studentEvidence", "nextAction", "reusableMaterial"]) assert.match(workspace, new RegExp(field));
  assert.match(workspace, /if \(busy\) return/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /tabIndex=\{-1\}/);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /event\.key !== "Tab"/);
  assert.match(workspace, /beforeunload/);
  assert.match(workspace, /formDirty/);
  assert.match(workspace, /previousFocusRef\.current\?\.focus/);
  assert.match(workspace, /当前反思尚未保存/);
});

test("AI reflection output remains an independent draft and only fills blank fields", async () => {
  const [workspace, aiRoute] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/api/v2/ai/reflection-drafts/route.ts"),
  ]);

  for (const label of ["AI 反思草稿", "草稿尚未保存", "采用草稿", "丢弃草稿", "隐私确认", "字段排除", "费用边界", "已有教师文字保持不变"]) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /if \(!text\(next\[key\], ""\) && text\(aiDraft\[key\], ""\)\)/);
  assert.match(workspace, /\/api\/v2\/ai\/reflection-drafts/);
  assert.match(aiRoute, /export async function POST/);
  assert.doesNotMatch(aiRoute, /^export \{.*from/m);
  assert.match(aiRoute, /sanitizeForAi/);
  assert.match(aiRoute, /学生姓名和联系方式/);
  assert.doesNotMatch(aiRoute, /INSERT INTO reflections/);
});

test("strategy promotion is explicit, evidence-bound and rolls back partial resources", async () => {
  const [workspace, reflectionRoute] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/api/v2/reflections/[id]/route.ts"),
  ]);

  assert.match(workspace, /至少记录有效做法、改进动作或可复用素材后才能沉淀/);
  assert.match(workspace, /教师明确选择/);
  assert.match(workspace, /\/api\/v2\/resources/);
  assert.match(workspace, /sourceRef: `reflection:\$\{row\.id\}`/);
  assert.match(workspace, /visibility: "private"/);
  assert.match(workspace, /if \(resourceId\) await requestJson\(`\/api\/v2\/resources/);
  assert.doesNotMatch(reflectionRoute, /insert\(resources\)/);
  assert.match(reflectionRoute, /SELECT id FROM resources WHERE source_ref/);
});

test("reflection APIs validate payloads, lesson access and versioned detail methods", async () => {
  const [listRoute, idRoute, versioned] = await Promise.all([
    read("app/api/v2/reflections/route.ts"),
    read("app/api/v2/reflections/[id]/route.ts"),
    read("app/api/v2/reflections/[id]/route.ts"),
  ]);

  for (const route of [listRoute, idRoute]) {
    assert.match(route, /request\.json\(\)/);
    assert.match(route, /Response\.json\(\{\s*error/);
    assert.match(route, /requireLessonAccess/);
  }
  assert.match(idRoute, /export async function GET/);
  assert.match(idRoute, /export async function PUT/);
  assert.match(idRoute, /export async function DELETE/);
  assert.match(versioned, /export async function GET/);
  assert.match(versioned, /export async function PUT/);
  assert.match(versioned, /export async function DELETE/);
  assert.doesNotMatch(versioned, /^export \{.*from/m);
});

test("V2 reflection workspace is responsive and touch-safe", async () => {
  const css = await read("app/v2/v2.css");

  assert.match(css, /\.v2-reflection-dialog>header button\{[^}]*width:44px[^}]*height:44px/);
  assert.match(css, /\.v2-reflection-editor-grid input[^}]*min-height:44px/);
  assert.match(css, /@media\(max-width:720px\)[^{]*\{\.v2-reflection-filters/);
  assert.match(css, /\.v2-reflection-list footer button\{[^}]*min-height:44px/);
  assert.match(css, /\.v2-reflection-calendar\{[^}]*overflow-x:auto/);
});
