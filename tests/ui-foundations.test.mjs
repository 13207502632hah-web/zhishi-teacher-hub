import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const luminance = (hex) => {
  const channels = hex.match(/\w\w/g).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("quiet study-room foundations expose the approved visual contract", async () => {
  const [layout, styles] = await Promise.all([
    read("app/layout.tsx"),
    read("app/ui-foundations.css"),
  ]);

  assert.match(layout, /import "\.\/ui-foundations\.css"/);
  for (const color of ["#F5F2EA", "#315346", "#22372F", "#C59A45"]) {
    assert.match(styles, new RegExp(color, "i"));
  }
  assert.match(styles, /body\s*\{[^}]*font-size:\s*1rem/s);
  assert.match(styles, /\.zs-caption\s*\{[^}]*font-size:\s*0\.875rem/s);
  assert.match(styles, /min-height:\s*2\.75rem/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(styles, /#d8f16b/i);
});

test("foundation text colors meet WCAG AA on their intended surfaces", async () => {
  const styles = await read("app/ui-foundations.css");
  const token = (name) => styles.match(new RegExp(`--zs-${name}:\\s*#([\\dA-F]{6})`, "i"))?.[1];
  const pairs = [
    [token("ink"), token("paper")],
    [token("pine"), token("surface")],
    [token("muted"), token("paper")],
    ["FFFFFF", token("pine")],
    ["FFFFFF", token("danger")],
  ];

  for (const [foreground, background] of pairs) {
    assert.ok(foreground && background);
    assert.ok(
      contrast(foreground, background) >= 4.5,
      `${foreground} on ${background} must reach 4.5:1`,
    );
  }
});

test("foundation primitives cover common teaching workspace states", async () => {
  const source = await read("app/components/ui/Primitives.tsx");

  for (const component of [
    "Button",
    "Panel",
    "MetricCard",
    "StatusBadge",
    "EmptyState",
    "TeachingLoopTrack",
  ]) {
    assert.match(source, new RegExp(`export function ${component}\\b`));
  }
  for (const stage of ["备课", "上课", "作业", "反馈", "结算"]) {
    assert.match(source, new RegExp(stage));
  }
});
