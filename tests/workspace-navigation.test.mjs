import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace navigation follows the approved desktop information architecture", async () => {
  const [config, shell] = await Promise.all([
    read("app/components/navigation.ts"),
    read("app/components/AppShell.tsx"),
  ]);

  for (const group of ["今日", "教学", "题库", "学情", "教研与运营"]) {
    assert.match(config, new RegExp(`group:\\s*"${group}"`));
  }
  for (const [href, label] of [
    ["/workspace", "今日"],
    ["/lessons", "课时"],
    ["/questions", "题库"],
    ["/classes", "学生"],
  ]) {
    assert.match(config, new RegExp(`href:\\s*"${href}"[^\\n]+label:\\s*"${label}"`));
  }
  assert.match(config, /utilityNavigation/);
  assert.match(config, /href:\s*"\/settings"/);
  assert.match(config, /href:\s*"\/mini-settings"/);
  assert.match(shell, /<WorkspaceNavigation/);
  assert.doesNotMatch(shell, /className="sideNav"/);
});

test("mobile navigation uses a fixed five-item bar and an accessible more drawer", async () => {
  const [navigation, config, styles, layout] = await Promise.all([
    read("app/components/WorkspaceNavigation.tsx"),
    read("app/components/navigation.ts"),
    read("app/workspace-navigation.css"),
    read("app/layout.tsx"),
  ]);
  const mobileContract = `${config}\n${navigation}`;

  assert.match(navigation, /aria-label="移动端主导航"/);
  assert.match(mobileContract, /今日/);
  assert.match(mobileContract, /课时/);
  assert.match(mobileContract, /题库/);
  assert.match(mobileContract, /学生/);
  assert.match(mobileContract, /更多/);
  assert.match(navigation, /role="dialog"/);
  assert.match(navigation, /aria-modal="true"/);
  assert.match(navigation, /aria-expanded=\{drawerOpen\}/);
  assert.match(navigation, /event\.key === "Escape"/);
  assert.match(navigation, /trigger\?\.focus\(\)/);
  assert.match(navigation, /region\.inert = true/);
  assert.match(styles, /\.mobileTabBar\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /min-height:\s*2\.75rem/);
  assert.match(styles, /\.workspaceSidebar__nav\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(styles, /@media\s*\(min-width:\s*64rem\)/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
  assert.match(layout, /import "\.\/workspace-navigation\.css"/);
});

test("assistant navigation hides routes whose APIs require analytics or academic-year permissions", async () => {
  const config = await read("app/components/navigation.ts");
  const assistantBlock = config.match(
    /if \(role === "assistant"\)[\s\S]*?return workspaceNavigation\.filter\([\s\S]*?\);\s*\n/,
  );
  assert.ok(assistantBlock, "assistant navigation filter must exist");
  for (const href of [
    "/reflections",
    "/analytics",
    "/assessments",
    "/exam-projects",
    "/recognition",
    "/academic-years",
    "/finance",
  ]) {
    assert.match(assistantBlock[0], new RegExp(`"${href}"`));
  }
  assert.match(assistantBlock[0], /!\[[\s\S]*\]\.includes\(item\.href\)/);
});
