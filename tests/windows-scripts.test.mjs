import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const teachingLoopSource = await readFile(
  new URL("../scripts/teaching-loop-e2e.mjs", import.meta.url),
  "utf8",
);

test("teaching loop e2e is self-contained on Windows", () => {
  assert.match(teachingLoopSource, /from "node:sqlite"/);
  assert.doesNotMatch(teachingLoopSource, /execFileSync\("sqlite3"/);
  assert.match(
    teachingLoopSource,
    /path\.join\(root,\s*"node_modules",\s*"vinext",\s*"dist",\s*"cli\.js"\)/,
  );
  assert.match(
    teachingLoopSource,
    /spawn\(process\.execPath,\s*\[devServerCli,\s*"dev"\]/,
  );
  assert.match(teachingLoopSource, /Date\.now\(\) \+ 60_000/);
  assert.doesNotMatch(teachingLoopSource, /pnpm\.cmd|shell:\s*true/);
});
