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
