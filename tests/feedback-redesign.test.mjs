import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("feedback is a V2-native learning workspace and the obsolete page is retired", async () => {
  const [modulePage, workspace, navigation, shell, lesson, layout] = await Promise.all([
    read("app/v2/modules/[slug]/page.tsx"),
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/components/navigation.ts"),
    read("app/components/AppShell.tsx"),
    read("app/v2/detail/[kind]/[id]/LessonDetailWorkspace.tsx"),
    read("app/layout.tsx"),
  ]);

  assert.match(modulePage, /initialLessonId/);
  assert.match(modulePage, /initialAi/);
  assert.match(workspace, /function FeedbackWorkspace/);
  assert.match(workspace, /initialLessonId/);
  assert.match(workspace, /deepLinkHandledRef/);
  assert.match(navigation, /\/v2\/modules\/learning\?view=feedback/);
  assert.match(shell, /\/v2\/modules\/learning\?view=feedback/);
  assert.match(lesson, /view=feedback&lessonId=/);
  assert.doesNotMatch(layout, /feedback\.css/);
  await assert.rejects(access(new URL("../app/feedback/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/feedback.css", import.meta.url)));
});

test("feedback loading is cancellable and every client request uses a versioned route", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  assert.match(workspace, /AbortController/);
  assert.match(workspace, /controller\.abort/);
  assert.match(workspace, /role="alert"/);
  for (const endpoint of [
    "/api/v2/feedback",
    "/api/v2/feedback/summary",
    "/api/v2/feedback/templates",
    "/api/v2/ai/feedback-drafts",
    "/api/v2/classes/options",
  ]) assert.match(workspace, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.doesNotMatch(workspace, /["'`]\/api\/feedback(?:[?\/"'`])/);
  assert.doesNotMatch(workspace, /["'`]\/api\/ai\/feedback-drafts/);
});

test("feedback preserves evidence, recoverable AI drafts and teacher review boundaries", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const marker of [
    "使用单节课真实记录",
    "汇总真实课时、出勤、作业与测验",
    "先核对发送字段",
    "尚未调用外部模型",
    "待确认 AI 反馈草稿",
    "继续核对",
    "放弃",
    "采用 AI 草稿",
    "已有教师文字保持不变",
    "我已逐项核对 AI 生成",
    "预计提交时间",
    "简短补充",
  ]) assert.match(workspace, new RegExp(marker));
  assert.match(workspace, /aiPreviewKey !== previewKey/);
  assert.match(workspace, /Boolean\(form\.aiGenerated\).*Boolean\(form\.aiReviewed\)/);
  assert.match(workspace, /evidenceRefs/);
  assert.match(workspace, /feedbackExcluded/);
});

test("formal feedback sending stays approval-backed and copy is recorded only after clipboard success", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  assert.match(workspace, /actionType: "feedback\.send"/);
  assert.match(workspace, /提交发送确认/);
  assert.match(workspace, /当前尚未发送给学生或家长/);
  assert.doesNotMatch(workspace, /\/api\/v2\/feedback\/\$\{row\.id\}\/sent/);
  assert.ok(
    workspace.indexOf("navigator.clipboard.writeText") < workspace.indexOf("`/api/v2/feedback/${row.id}/copied`"),
    "clipboard write must happen before the server records a copied state",
  );
  assert.match(workspace, /if \(busy\) return/);
  assert.match(workspace, /finally/);
});

test("feedback dialog protects unsaved work and remains touch-safe, responsive and printable", async () => {
  const [workspace, css] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/v2/v2.css"),
  ]);

  assert.match(workspace, /beforeunload/);
  assert.match(workspace, /event\.key === "Escape"/);
  assert.match(workspace, /event\.key !== "Tab"/);
  assert.match(workspace, /previousFocusRef\.current\?\.focus/);
  assert.match(workspace, /tabIndex=\{-1\}/);
  assert.match(workspace, /window\.confirm/);
  assert.match(css, /\.v2-feedback-backdrop\{[^}]*z-index:125/s);
  assert.match(css, /\.v2-feedback-editor-grid[^}]*grid-template-columns:repeat\(2/s);
  assert.match(css, /@media\(max-width:720px\)[^{]*\{[^}]*\.v2-feedback/s);
  assert.match(css, /min-height:44px/);
  assert.match(css, /@media print\{[^}]*v2-feedback-print/s);
});

test("native V2 feedback routes expose list, detail, copied, summary, templates and AI drafts", async () => {
  const sources = await Promise.all([
    "app/api/v2/feedback/route.ts",
    "app/api/v2/feedback/[id]/route.ts",
    "app/api/v2/feedback/[id]/copied/route.ts",
    "app/api/v2/feedback/summary/route.ts",
    "app/api/v2/feedback/templates/route.ts",
    "app/api/v2/ai/feedback-drafts/route.ts",
  ].map(read));

  assert.match(sources[0], /export async function GET/);
  assert.match(sources[0], /export async function POST/);
  assert.match(sources[1], /export async function PUT/);
  assert.match(sources[1], /export async function DELETE/);
  assert.match(sources[2], /export async function POST/);
  assert.match(sources[3], /export async function GET/);
  assert.match(sources[4], /export async function GET/);
  assert.match(sources[4], /export async function POST/);
  assert.match(sources[5], /export async function GET/);
  assert.match(sources[5], /export async function DELETE/);
  assert.match(sources[5], /export async function POST/);
  for (const source of sources) assert.doesNotMatch(source, /^export \{.*from/m);
});
