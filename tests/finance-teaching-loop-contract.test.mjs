import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("teaching loop carries the signed finance preview contract into confirmation", async () => {
  const script = await readFile(new URL("../scripts/teaching-loop-e2e.mjs", import.meta.url), "utf8");
  const start = script.indexOf("const financeOperationId");
  const end = script.indexOf("const feedbackSummary", start);
  assert.ok(start >= 0 && end > start, "finance teaching-loop section must exist");

  const financeFlow = script.slice(start, end);
  assert.match(financeFlow, /const financeOperationId\s*=/);
  assert.match(financeFlow, /action:\s*"preview"[\s\S]*?operationId:\s*financeOperationId/);
  assert.match(financeFlow, /action:\s*"confirm"[\s\S]*?operationId:\s*financeOperationId/);
  assert.match(financeFlow, /previewToken:\s*financePreview\.data\.previewToken/);
});
