import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("quick switcher searches every role-approved navigation entry", async () => {
  const shell = await read("app/components/AppShell.tsx");

  assert.match(shell, /const commandNavigation\s*=\s*\[\.\.\.visibleItems,\s*\.\.\.visibleUtilities\]/);
  assert.match(shell, /const commandItems\s*=\s*commandNavigation\.filter/);
  assert.doesNotMatch(shell, /const commandItems\s*=\s*visibleItems\.filter/);
});

test("quick switcher traps focus and restores its trigger on close", async () => {
  const shell = await read("app/components/AppShell.tsx");

  assert.match(shell, /commandTriggerRef/);
  assert.match(shell, /commandDialogRef/);
  assert.match(shell, /const closeCommand\s*=\s*useCallback/);
  assert.match(shell, /commandTriggerRef\.current\?\.focus\(\)/);
  assert.match(shell, /commandOpen\s*&&\s*event\.key\s*===\s*"Tab"/);
  assert.match(shell, /querySelectorAll<HTMLElement>/);
});

test("quick switcher text and controls meet readable touch-safe sizing", async () => {
  const styles = await read("app/design-system.css");

  assert.match(styles, /\.commandTrigger\{[^}]*min-height:44px/);
  assert.match(styles, /\.commandTrigger span\{font-size:14px\}/);
  assert.match(styles, /\.quickSwitcher\{width:min\(620px,100%\)/);
  assert.doesNotMatch(styles, /\.quickSwitcher\{[^}]*100vw/);
  assert.match(styles, /\.quickSwitcherSearch input\{[^}]*font-size:16px/);
  assert.match(styles, /\.quickSwitcherSearch button\{[^}]*min-width:44px[^}]*min-height:44px[^}]*font-size:14px/);
  assert.match(styles, /\.quickSwitcherResults>a\{[^}]*min-height:44px/);
  assert.match(styles, /\.quickSwitcherResults b\{font-size:16px\}/);
  assert.match(styles, /\.quickSwitcherResults small\{[^}]*font-size:14px/);
  assert.match(styles, /\.quickSwitcher footer\{[^}]*font-size:14px/);
});
