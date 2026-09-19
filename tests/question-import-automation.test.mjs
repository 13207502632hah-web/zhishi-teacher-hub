import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("question import automation is narrow, secret-backed, idempotent and auditable", async () => {
  const [auth, route, access, envTypes] = await Promise.all([
    read("app/lib/question-import-automation.ts"),
    read("app/api/v2/questions/imports/automation/route.ts"),
    read("app/lib/access.ts"),
    read("cloudflare-env.d.ts"),
  ]);
  assert.match(envTypes, /QUESTION_IMPORT_AUTOMATION_TOKEN\?: string/);
  assert.match(auth, /env\.QUESTION_IMPORT_AUTOMATION_TOKEN/);
  assert.match(auth, /crypto\.subtle\.digest/);
  assert.match(auth, /\^Bearer\\s\+/);
  assert.doesNotMatch(auth, /searchParams|cookie/i);
  assert.match(access, /getQuestionImportAutomationAccess/);
  assert.match(route, /X-Operation-Id/i);
  assert.match(route, /createQuestionImportV2/);
  assert.match(route, /deferV2BackgroundJob/);
  assert.match(route, /automation_question_import_created/);
  assert.match(route, /sourceFingerprint/);
  assert.match(route, /getQuestionImportV2/);
  assert.match(route, /\["queued", "running"\]\.includes\(item\.job\.state\)/);
});

test("DOCX automation persists deterministic parsing without blocking on whole-paper AI", async () => {
  const intake = await read("app/lib/v2/question-import-service.ts");
  assert.match(intake, /if \(extension === "docx" && localQuestions\.length\) questions = localQuestions/);
  assert.match(intake, /else try \{/);
  assert.match(intake, /callV2AiJson/);
  assert.match(intake, /imported\.status === 409 && Number\(result\.duplicates \|\| 0\) > 0/);
  assert.match(intake, /stage: "completed_duplicate"/);
  assert.match(intake, /skippedAsDuplicate: true/);
  assert.match(intake, /result: output, error: \{\}/);
});

test("paired paper and answer imports are stored together and matched by original question number", async () => {
  const [intake, search, library] = await Promise.all([
    read("app/lib/v2/question-import-service.ts"),
    read("app/v2/questions/QuestionSearch.tsx"),
    read("app/v2/questions/QuestionLibraryWorkspace.tsx"),
  ]);
  assert.match(intake, /form\.get\("answerFile"\)/);
  assert.match(intake, /answerStorageKey/);
  assert.match(intake, /第一个是题卷、第二个是答案卷/);
  assert.match(intake, /按原题号逐题匹配答案与解析/);
  assert.match(search, /题卷＋答案成对导入/);
  assert.match(search, /form\.append\("answerFile", answerFile\)/);
  assert.match(library, /题卷＋答案成对导入/);
});

test("question import CLI preflights fingerprints and never accepts a token argument", async () => {
  const script = await read("scripts/import-question-docx.mjs");
  assert.match(script, /QUESTION_IMPORT_AUTOMATION_TOKEN/);
  assert.match(script, /sourceFingerprint=/);
  assert.match(script, /X-Operation-Id/);
  assert.match(script, /source_already_imported/);
  assert.match(script, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.doesNotMatch(script, /valueOf\("--token"\)/);
});
