import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared icon buttons expose a 44 by 44 CSS-pixel touch target", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const finalRuleStart = css.lastIndexOf(".iconButton");
  const finalRule = css.slice(finalRuleStart, css.indexOf("}", finalRuleStart) + 1);

  assert.ok(finalRuleStart >= 0, "shared icon button rule must exist");
  assert.match(finalRule, /min-width:\s*2\.75rem/);
  assert.match(finalRule, /min-height:\s*2\.75rem/);
  assert.match(finalRule, /width:\s*2\.75rem/);
  assert.match(finalRule, /height:\s*2\.75rem/);
});
