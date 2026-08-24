import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 feedback import accepts pasted text or private local-OCR evidence", async () => {
  const [workspace, upload] = await Promise.all([read("app/v2/operations/OperationsWorkspace.tsx"), read("app/api/v2/files/route.ts")]);

  assert.match(workspace, /recognizeChineseImage/);
  assert.match(workspace, /purpose", "feedback-import"/);
  assert.doesNotMatch(workspace, /ownerType/);
  assert.match(upload, /"feedback-import": \{ ownerType: "feedback_import"/);
  assert.match(workspace, /name="sourceText"/);
  assert.match(workspace, /name="ocrText"/);
  assert.match(workspace, /name="sourceAssetId"/);
  assert.match(workspace, /图片 OCR 只在当前浏览器运行/);
});

test("feedback image OCR is bounded, retryable and protected from accidental navigation", async () => {
  const workspace = await read("app/v2/operations/OperationsWorkspace.tsx");

  assert.match(workspace, /image\/jpeg/);
  assert.match(workspace, /image\/png/);
  assert.match(workspace, /image\/webp/);
  assert.match(workspace, /25 \* 1024 \* 1024/);
  assert.match(workspace, /ocrBusy/);
  assert.match(workspace, /finally \{ setOcrBusy\(false\); \}/);
  assert.match(workspace, /beforeunload/);
  assert.match(workspace, /hasUnsavedSource/);
});

test("V2 feedback review exposes structured fields and original evidence", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  for (const label of ["匹配在读学生", "日期", "开始时间", "结束时间", "上课地点", "实际教学内容", "未发布草稿", "下节计划", "原文证据", "原始文字 / OCR 文字"]) assert.match(detail, new RegExp(label));
  assert.match(detail, /data\.students/);
  assert.match(detail, /readParsedPayload/);
  assert.match(detail, /结束时间必须晚于开始时间/);
  assert.match(detail, /有未保存修改/);
});

test("formal reverse lesson write always enters approval after saved validation", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  assert.match(detail, /actionType: "feedback_import\.confirm"/);
  assert.match(detail, /反馈解析正式写入已进入待确认中心/);
  assert.match(detail, /disabled=\{busy \|\| dirty \|\| !requiredReady/);
  assert.match(detail, /本页不直接覆盖已完成课时/);
});

test("feedback source asset and student list remain server-controlled", async () => {
  const [listRoute, detailRoute] = await Promise.all([read("app/api/v2/feedback-imports/route.ts"), read("app/api/v2/feedback-imports/[id]/route.ts")]);
  assert.match(listRoute, /created_by=\?/);
  assert.match(listRoute, /mime_type IN \('image\/jpeg','image\/png','image\/webp'\)/);
  assert.match(listRoute, /\.slice\(0, 100000\)/);
  assert.match(detailRoute, /WHERE status='active'/);
  assert.match(detailRoute, /students: students\.results/);
});

test("retired feedback-import page is removed and V2 evidence is mobile-first", async () => {
  await assert.rejects(access(new URL("../app/feedback-imports/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/feedback-imports.css", import.meta.url)));
  const [layout, navigation, css] = await Promise.all([read("app/layout.tsx"), read("app/components/navigation.ts"), read("app/v2/v2.css")]);
  assert.doesNotMatch(layout, /feedback-imports\.css/);
  assert.match(navigation, /href:\s*"\/v2\/operations\?tab=imports"/);
  assert.doesNotMatch(navigation, /href:\s*"\/feedback-imports"/);
  assert.match(css, /\.v2-import-evidence/);
  assert.match(css, /@media\(max-width:720px\).*\.v2-import-evidence>div\{grid-template-columns:1fr\}/s);
});
