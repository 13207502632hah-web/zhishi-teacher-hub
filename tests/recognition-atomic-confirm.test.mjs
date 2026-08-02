import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("recognition final confirmation commits every formal write atomically and only once", async () => {
  const route = await read("app/api/recognition/route.ts");
  const confirmStart = route.indexOf('if (action !== "confirm")');
  assert.ok(confirmStart >= 0, "final confirmation branch must exist");
  const confirmBranch = route.slice(confirmStart);

  assert.match(confirmBranch, /const confirmStatements\s*=/);
  assert.match(confirmBranch, /await env\.DB\.batch\(confirmStatements\)/);
  assert.match(confirmBranch, /INSERT INTO assessment_results[\s\S]*?WHERE EXISTS \(SELECT 1 FROM recognition_jobs WHERE id=\? AND stage!='confirmed'\)/);
  assert.match(confirmBranch, /INSERT INTO assessment_question_results[\s\S]*?WHERE EXISTS \(SELECT 1 FROM recognition_jobs WHERE id=\? AND stage!='confirmed'\)/);
  assert.match(confirmBranch, /INSERT INTO knowledge_evidence[\s\S]*?WHERE EXISTS \(SELECT 1 FROM recognition_jobs WHERE id=\? AND stage!='confirmed'\)/);
  assert.match(confirmBranch, /INSERT INTO audit_logs[\s\S]*?WHERE EXISTS \(SELECT 1 FROM recognition_jobs WHERE id=\? AND stage!='confirmed'\)/);
  assert.match(confirmBranch, /UPDATE recognition_jobs SET stage='confirmed'[\s\S]*?WHERE id=\? AND stage!='confirmed'/);
  assert.match(confirmBranch, /meta\?\.changes/);

  assert.doesNotMatch(confirmBranch, /await audit\(access, "confirm"/);
  assert.doesNotMatch(confirmBranch, /await env\.DB\.prepare\("INSERT INTO assessment_results[\s\S]*?\.run\(\)/);
});
