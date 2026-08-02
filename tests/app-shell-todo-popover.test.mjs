import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("teaching todo popover uses the shared request layer and exposes recovery", async () => {
  const shell = await read("app/components/AppShell.tsx");

  assert.match(shell, /import \{ HttpError, requestJson \} from "@\/app\/lib\/http-client"/);
  assert.match(shell, /requestJson<[^>]+>\("\/api\/dashboard"/);
  assert.doesNotMatch(shell, /fetch\("\/api\/dashboard"/);
  assert.match(shell, /todoError/);
  assert.match(shell, /\u5f85\u529e\u8bfb\u53d6\u5931\u8d25/);
  assert.match(shell, />\u91cd\u65b0\u8bfb\u53d6</);
});

test("teaching todo popover closes accessibly and restores its trigger", async () => {
  const shell = await read("app/components/AppShell.tsx");

  assert.match(shell, /todoTriggerRef/);
  assert.match(shell, /aria-controls="teaching-todo-popover"/);
  assert.match(shell, /id="teaching-todo-popover"/);
  assert.match(shell, /event\.key === "Escape"[^]*closeTodos/);
  assert.match(shell, /todoTriggerRef\.current\?\.focus\(\)/);
  assert.match(shell, /todoPopoverRef\.current\?\.contains\(target\)[^]*closeTodos/);
});

test("teaching todo popover keeps supporting text readable and rows touch friendly", async () => {
  const styles = await read("app/responsive-fixes.css");

  assert.match(styles, /\.todoPopover p\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(styles, /\.todoPopover\s*\{[^}]*width:\s*min\(22rem,calc\(100vw - 3rem\)\)/s);
  assert.match(styles, /\.todoPopover li a\s*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(styles, /\.todoPopover>div button\s*\{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/s);
});
