import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("teacher toolbox reuses current class membership without new student storage", async () => {
  const [workspace, shell] = await Promise.all([read("app/v2/toolbox/ToolboxWorkspace.tsx"), read("app/v2/V2Shell.tsx")]);
  assert.match(workspace, /api\/v2\/classes\?status=active/);
  assert.match(workspace, /api\/v2\/classes\/\$\{classId\}/);
  assert.match(workspace, /crypto\.getRandomValues/);
  assert.doesNotMatch(workspace, /fetch\([^\n]+method:\s*["']POST["']/);
  assert.match(shell, /href: "\/v2\/toolbox"/);
});

test("arithmetic tool generates integer-safe division and local scoring", async () => {
  const workspace = await read("app/v2/toolbox/ToolboxWorkspace.tsx");
  assert.match(workspace, /divisor \* quotient/);
  assert.match(workspace, /answer: quotient/);
  assert.match(workspace, /立即判分/);
  assert.match(workspace, /Number\(answers\[question\.id\]\) === question\.answer/);
  assert.match(workspace, /window\.print\(\)/);
});

test("lesson material shortcuts point to existing V2 workflows", async () => {
  const workspace = await read("app/v2/toolbox/ToolboxWorkspace.tsx");
  for (const path of ["/v2/class-files", "/v2/modules/resources", "/v2/modules/students", "/v2/assistant"]) assert.match(workspace, new RegExp(path.replaceAll("/", "\\/")));
});
