import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 recognition creates a private task from an explicit student and assessment", async () => {
  const workspace = await read("app/v2/operations/OperationsWorkspace.tsx");

  for (const field of ["studentId", "assessmentId", "answerCard", "ownershipConfirmed"]) assert.match(workspace, new RegExp(`name="${field}"`));
  assert.match(workspace, /\/api\/v2\/files/);
  assert.match(workspace, /purpose", "answer-card"/);
  assert.match(workspace, /\/api\/v2\/recognition/);
  assert.match(workspace, /router\.push\(`\/v2\/operations\/recognition\/\$\{id\}`\)/);
  assert.match(workspace, /未经确认不会调用外部 AI/);
});

test("answer-card upload is bounded before network writes", async () => {
  const workspace = await read("app/v2/operations/OperationsWorkspace.tsx");

  assert.match(workspace, /image\/jpeg/);
  assert.match(workspace, /image\/png/);
  assert.match(workspace, /image\/webp/);
  assert.match(workspace, /25 \* 1024 \* 1024/);
  assert.match(workspace, /答题卡图片必须小于 25MB/);
  assert.match(workspace, /if \(busy\) return/);
  assert.match(workspace, /finally \{ setBusy\(false\); \}/);
});

test("AI recognition requires one-time real-name consent and remains a draft", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  assert.match(detail, /原答题卡发送给外部视觉模型/);
  assert.match(detail, /realNameContextConfirmed: true/);
  assert.match(detail, /action: "aiRecognize"/);
  assert.match(detail, /AI 识别草稿已更新/);
  assert.match(detail, /禁止按置信度一键确认/);
});

test("question review protects unsaved work and blocks incomplete formal confirmation", async () => {
  const detail = await read("app/v2/operations/[kind]/[id]/OperationDetail.tsx");

  assert.match(detail, /beforeunload/);
  assert.match(detail, /有未保存修改/);
  assert.match(detail, /recognitionIssues/);
  for (const label of ["缺少题号", "缺少学生答案", "得分或满分未填写", "分数无效或超过满分", "缺少知识点", "识别字段仍有冲突", "尚未人工确认"]) assert.match(detail, new RegExp(label));
  assert.match(detail, /issues\.length > 0/);
  assert.match(detail, /dirty \|\| uploadingItem/);
});

test("recognition final write enters approval and its service remains manual and idempotent", async () => {
  const [detail, route, confirmation] = await Promise.all([read("app/v2/operations/[kind]/[id]/OperationDetail.tsx"), read("app/api/v2/recognition/route.ts"), read("app/lib/services/recognition-confirmation.ts")]);

  assert.match(detail, /actionType: "recognition\.confirm"/);
  assert.match(detail, /答题卡正式写入已进入待确认中心/);
  assert.match(confirmation, /item\.review_status\s*===\s*["']confirmed["']/);
  assert.match(confirmation, /alreadyConfirmed/);
  assert.match(route, /必须逐题人工确认/);
  assert.match(route, /question_number=\?/);
  assert.match(route, /\.slice\(0, 200\)/);
  assert.match(route, /mime_type IN \('image\/jpeg','image\/png','image\/webp'\)/);
  assert.match(route, /created_by=\?/);
  assert.match(route, /所选学生不属于该测评班级/);
  assert.doesNotMatch(route + confirmation, /UPDATE recognition_items SET review_status='confirmed'.*confidence/);
  assert.match(route, /正式成绩确认必须进入待确认中心/);
  const gate = confirmation.indexOf("仍有"), resultWrite = confirmation.indexOf("INSERT INTO assessment_results");
  assert.ok(gate >= 0 && resultWrite > gate, "formal results must be written after the manual confirmation gate");
});

test("retired recognition page is removed and V2 controls are phone-safe", async () => {
  await assert.rejects(access(new URL("../app/recognition/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/recognition/recognition.module.css", import.meta.url)));
  const [navigation, css] = await Promise.all([read("app/components/navigation.ts"), read("app/v2/v2.css")]);
  assert.match(navigation, /href:\s*"\/v2\/operations\?tab=recognition"/);
  assert.doesNotMatch(navigation, /href:\s*"\/recognition"/);
  assert.match(css, /\.v2-inline-create \.v2-review-check\{min-height:44px\}/);
  assert.match(css, /@media\(max-width:720px\)/);
});
