import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("question workflows override legacy tiny text with readable sizes", async () => {
  const css = await read("app/questions-list.css");

  assert.match(css, /\.primaryTabs a,[\s\S]*?font-size:\s*0\.875rem/);
  assert.match(css, /\.primaryTabs a b\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.questionWorkflow span[\s\S]*?font-size:\s*1rem/);
  assert.match(css, /\.questionWorkflow small,[\s\S]*?font-size:\s*0\.875rem/);
  assert.match(css, /\.questionQuickTools,[\s\S]*?font-size:\s*0\.875rem/);
  assert.match(css, /\.questionHealth span\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.resultSummary,[\s\S]*?\.resultSummary span\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.questionList \.emptyState \.secondaryButton\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.stepBar b,[\s\S]*?\.stepBar span\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(css, /\.wizardCenter p,[\s\S]*?\.wizardSummary p\s*\{[^}]*font-size:\s*1rem/s);
  assert.match(css, /\.queueStatus,[\s\S]*?font-size:\s*0\.875rem/);
  assert.match(css, /\.duplicateCompare p\s*\{[^}]*font-size:\s*1rem/s);
});

test("question quick actions and import controls expose 44px touch targets", async () => {
  const css = await read("app/questions-list.css");

  assert.match(css, /\.questionQuickTools button,[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.tagRow button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
  assert.match(css, /\.queueMeta input,[\s\S]*?min-height:\s*44px[\s\S]*?font-size:\s*1rem/);
  assert.match(css, /\.paperCartBar \.primaryButton\s*\{[^}]*min-height:\s*44px/s);
});

test("question import guidance contains no sub-14px text", async () => {
  const css = await read("app/questions/questions.module.css");

  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|1[0-3])px/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /line-height:\s*1\.7/);
});
