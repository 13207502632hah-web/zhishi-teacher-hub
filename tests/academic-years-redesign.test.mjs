import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("academic year promotion is a four-stage preview-first workflow", async () => {
  const page = await read("app/academic-years/page.tsx");

  for (const stage of ["选择学年", "生成预览", "核对影响", "最终确认"]) {
    assert.match(page, new RegExp(stage));
  }
  assert.match(page, /data-stage/);
  assert.match(page, /stage/);
  assert.match(page, /previewData/);
  assert.match(page, /confirmationOpen/);
  assert.match(page, /进入最终确认/);
  assert.match(page, /我已阅读影响，确认执行学年晋升/);
  assert.doesNotMatch(page, /确认未排除学生/);
});

test("promotion preview uses the resilient JSON client and recoverable states", async () => {
  const page = await read("app/academic-years/page.tsx");

  assert.match(page, /requestJson/);
  assert.match(page, /HttpError/);
  assert.match(page, /AbortController/);
  assert.match(page, /previewLoadError/);
  assert.match(page, /重新生成预览/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
  assert.match(page, /本学年没有可生成晋升的学生/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("promotion preview exposes impact counts and stale-data protection", async () => {
  const page = await read("app/academic-years/page.tsx");

  for (const field of [
    "affectedStudentCount",
    "affectedClassCount",
    "graduationCount",
    "skippedCount",
    "conflictCount",
    "previewToken",
    "previewExpiresAt",
    "requiresPreview",
  ]) {
    assert.match(page, new RegExp(field));
  }
  assert.match(page, /预览已过期或数据已变化，请重新生成预览/);
  assert.match(page, /previewExpired \|\| hasConflicts/);
  assert.match(page, /预览已过期，请重新生成预览后再确认/);
  assert.match(page, /冲突/);
  assert.match(page, /跳过/);
  assert.match(page, /毕业/);
});

test("promotion confirmation is teacher-only, explicit, and cannot overlap", async () => {
  const page = await read("app/academic-years/page.tsx");

  assert.match(page, /useSessionState/);
  assert.match(page, /session\.role === "teacher"/);
  assert.match(page, /只有教师可以执行学年晋升/);
  assert.match(page, /if \(busyAction\)/);
  assert.match(page, /busyActionRef/);
  assert.match(page, /finally\s*\{[\s\S]*setBusyAction\(null\)/);
  assert.match(page, /confirmation: "确认晋升"/);
  assert.match(page, /confirmPhrase/);
  assert.match(page, /disabled=\{[^}]*confirmPhrase/);
});

test("confirmation dialog supports escape, focus trapping, and focus restoration", async () => {
  const page = await read("app/academic-years/page.tsx");

  assert.match(page, /dialogRef/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "Tab"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /tabIndex=\{-1\}/);
  assert.match(page, /不可轻易撤销/);
});

test("带学年查询参数的初次预览不会因忙碌状态变化被 effect 中止", async () => {
  const page = await read("app/academic-years/page.tsx");

  assert.match(page, /const beginAction = useCallback\(\(action: Exclude<BusyAction, null>\) => \{\s*if \(busyActionRef\.current\) return false;/s);
  assert.match(page, /setBusyAction\(action\);\s*return true;\s*\}, \[\]\);/s);
  assert.match(page, /async \(selectedYear: string, signal\?: AbortSignal\)/);
  assert.match(page, /\[beginAction\],\s*\);\s*\n\s*useEffect\(\(\) => \{/s);
});

test("academic year promotion page uses a CSS Module with readable touch-safe mobile-first styles", async () => {
  const [page, css] = await Promise.all([
    read("app/academic-years/page.tsx"),
    read("app/academic-years/academic-years.module.css"),
  ]);

  assert.match(page, /academic-years\.module\.css/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.table input[\s\S]*width:\s*2\.75rem[\s\S]*height:\s*2\.75rem/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /overflow-x:\s*auto/);
});

test("promotion API separates teacher confirmation from preview access and rejects stale confirmations", async () => {
  const route = await read("app/api/academic-years/[year]/promotion/route.ts");

  assert.match(route, /academicYearDates/);
  assert.match(route, /requirePermission\("academic-years:read"\)/);
  assert.match(route, /requirePermission\("academic-years:write"\)/);
  assert.match(route, /access\.role === "teacher"/);
  assert.match(route, /previewToken/);
  assert.match(route, /previewExpiresAt/);
  assert.match(route, /requiresPreview: true/);
  assert.match(route, /status:\s*409/);
  assert.match(route, /confirmation === "确认晋升"/);
  assert.match(route, /冲突/);
  assert.match(route, /skipped/);
  assert.match(route, /affectedClassCount/);
  assert.match(route, /graduationCount/);
});

test("promotion API guards the batch and does not report repeated requests as success", async () => {
  const route = await read("app/api/academic-years/[year]/promotion/route.ts");

  assert.match(route, /status='confirming'/);
  assert.match(route, /status='preview'/);
  assert.match(route, /env\.DB\.batch/);
  assert.match(route, /AND grade=\?/);
  assert.match(route, /NOT EXISTS/);
  assert.match(route, /status='confirmed'/);
  assert.match(route, /updated_at/);
  assert.doesNotMatch(route, /repeated:\s*true/);
  assert.match(route, /确认失败|晋升未完成/);
});
