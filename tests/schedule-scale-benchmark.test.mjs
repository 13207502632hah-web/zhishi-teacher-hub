import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("schedule scale gate covers 10, 100, 500 and 2000 rows with resume, repeat and undo", async () => {
  const source = await readFile(new URL("../scripts/schedule-scale-benchmark.mjs", import.meta.url), "utf8");
  for (const marker of ["[10, 100, 500, 2000]", "interruptionAt", "processRange(interruptionAt, size)", "INSERT OR IGNORE INTO lessons", "repeatMaintainedCount", "DELETE FROM lessons", "chunkSize: 50", "schedule-scale.json"]) assert.match(source, new RegExp(marker.replace(/[()[\]]/g, "\\$&")));
});
