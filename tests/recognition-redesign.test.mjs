import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("recognition presents five explicit stages before any formal write", async () => {
  const page = await read("app/recognition/page.tsx");

  assert.match(page, /import styles from "\.\/recognition\.module\.css"/);
  assert.match(page, /aria-label="答题卡处理步骤"/);
  for (const label of ["选择学生与测验", "上传原图", "本机OCR", "逐题校对", "教师最终确认"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /本机OCR.*初步|OCR.*初步识别/);
  assert.match(page, /未经教师确认.*正式成绩|确认前.*正式成绩/);
});

test("recognition uses requestJson and lets student and assessment lists recover independently", async () => {
  const page = await read("app/recognition/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /studentLoadError/);
  assert.match(page, /assessmentLoadError/);
  assert.match(page, /重新读取学生名单/);
  assert.match(page, /重新读取测验/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /\.json\(\)/);
});

test("upload, OCR, review save and final confirmation have independent retry and dedupe states", async () => {
  const page = await read("app/recognition/page.tsx");

  for (const operation of ["uploadState", "ocrState", "saveState", "confirmState"]) {
    assert.match(page, new RegExp(operation));
    assert.match(page, new RegExp(`if \\(${operation}\\.status === "loading"\\) return`));
  }
  for (const label of ["重试上传", "重试OCR", "重试保存校对", "重试最终确认"]) assert.match(page, new RegExp(label));
  assert.match(page, /finally\s*\{[\s\S]*?setUploadState/);
  assert.match(page, /finally\s*\{[\s\S]*?setOcrState/);
  assert.match(page, /finally\s*\{[\s\S]*?setSaveState/);
  assert.match(page, /finally\s*\{[\s\S]*?setConfirmState/);
});

test("recognition validates image files locally and marks weak, missing, conflicting or invalid fields as uncertain", async () => {
  const page = await read("app/recognition/page.tsx");

  assert.match(page, /MAX_FILE_SIZE\s*=\s*25\s*\*\s*1024\s*\*\s*1024/);
  assert.match(page, /ALLOWED_IMAGE_TYPES/);
  assert.match(page, /file\.type/);
  assert.match(page, /file\.size/);
  assert.match(page, /文件不能为空/);
  assert.match(page, /REVIEW_CONFIDENCE/);
  assert.match(page, /conflict/i);
  assert.match(page, /存疑/);
  assert.match(page, /isScoreInvalid/);
  assert.match(page, /Number\.isFinite/);
  assert.match(page, /uncertain/);
});

test("question review exposes the required fields and a pre-confirmation score summary", async () => {
  const page = await read("app/recognition/page.tsx");

  for (const label of ["题号", "学生答案", "得分", "满分", "知识点", "状态"]) assert.match(page, new RegExp(label));
  for (const field of ["questionNumber", "studentAnswer", "teacherScore", "maxScore", "knowledgePoints", "reviewStatus"]) assert.match(page, new RegExp(field));
  for (const label of ["题目数量", "总分", "存疑项数量"]) assert.match(page, new RegExp(label));
  assert.match(page, /finalConfirm|openConfirm/);
  assert.match(page, /确认并写入正式成绩|确认并写入正式学情/);
});

test("recognition protects unsaved review work and makes the final confirmation dialog keyboard-safe", async () => {
  const page = await read("app/recognition/page.tsx");

  assert.match(page, /hasUnsavedReview/);
  assert.match(page, /beforeunload/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /useRef/);
  assert.match(page, /tabIndex=\{-1\}/);
});

test("recognition API requires manual confirmation and makes final confirmation idempotent", async () => {
  const route = await read("app/api/recognition/route.ts");

  assert.match(route, /item\.review_status\s*===\s*["']confirmed["']/);
  assert.match(route, /job\.stage\s*===\s*["']confirmed["']/);
  assert.match(route, /alreadyConfirmed/);
  assert.match(route, /必须逐题人工确认/);
  assert.doesNotMatch(route, /UPDATE recognition_items SET review_status='confirmed'.*confidence/);
  assert.match(route, /Number\.isFinite/);
  const gate = route.indexOf("仍有");
  const resultWrite = route.indexOf("INSERT INTO assessment_results");
  assert.ok(gate >= 0 && resultWrite > gate, "formal assessment results must be written after the confirmation gate");
});

test("recognition CSS module is readable, touch-safe and mobile-first", async () => {
  const css = await read("app/recognition/recognition.module.css");

  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /overflow/);
  assert.match(css, /@media\s*\(max-width:\s*48rem\)/);
});
