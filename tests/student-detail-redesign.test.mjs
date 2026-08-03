import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("student detail loads each evidence section through the typed request layer", async () => {
  const page = await read("app/students/[id]/page.tsx");

  assert.match(page, /import \{ HttpError, requestJson \} from "\.\.\/\.\.\/lib\/http-client"/);
  assert.match(page, /AbortController/);
  assert.match(page, /requestJson<.*students\/\$\{(?:id|encodedId)\}/s);
  for (const section of ["mastery", "insights", "trend"]) {
    assert.match(page, new RegExp(`${section}: \\{ loading:`));
    assert.match(page, new RegExp(`sectionStates\\.${section}\\.(?:loading|error)`));
  }
  assert.match(page, /重新读取/);
  assert.match(page, /role="alert"/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /Promise\.all\(/);
  assert.doesNotMatch(page, /response\.json\(\)/);
});

test("student detail mutations guard duplicate submits and recover from failures", async () => {
  const page = await read("app/students/[id]/page.tsx");

  for (const state of ["saveBusy", "wrongSaveBusy", "masterySaveBusy", "archiveBusy"]) {
    assert.match(page, new RegExp(state));
  }
  assert.match(page, /finally\s*\{/);
  assert.match(page, /disabled=\{[^}]*Busy/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(page, /复制失败|剪贴板不可用/);
  assert.match(page, /保存失败|操作失败/);
  assert.match(page, /权限不足|暂无权限/);
});

test("student detail dialogs preserve focus, escape, and unfinished edits", async () => {
  const page = await read("app/students/[id]/page.tsx");

  assert.match(page, /dialogRef/);
  assert.match(page, /previousFocusRef/);
  assert.match(page, /focusableSelector/);
  assert.match(page, /Escape/);
  assert.match(page, /beforeunload/);
  assert.match(page, /未保存/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /aria-labelledby=/);
  assert.match(page, /aria-describedby=/);
});

test("student detail keeps sensitive data and AI output teacher-controlled", async () => {
  const page = await read("app/students/[id]/page.tsx");

  assert.match(page, /监护人联系方式属于敏感信息/);
  assert.match(page, /教师确认后查看/);
  assert.match(page, /\/private/);
  assert.match(page, /归档学生/);
  assert.match(page, /删除错题/);
  assert.match(page, /推荐不会自动布置/);
  assert.match(page, /尚未布置或写入学生档案/);
  assert.match(page, /数据不足/);
  assert.match(page, /计算依据|可解释/);
});

test("student detail uses a mobile-first CSS module and existing design tokens", async () => {
  const [page, css] = await Promise.all([
    read("app/students/[id]/page.tsx"),
    read("app/students/[id]/student-detail.module.css"),
  ]);

  assert.match(page, /student-detail\.module\.css/);
  assert.match(page, /className=\{styles\./);
  assert.doesNotMatch(page, /className="(?:panel|profileGrid|modalBackdrop)/);
  assert.match(css, /var\(--zs-/);
  assert.match(css, /font-size:\s*1rem/);
  assert.match(css, /font-size:\s*0\.875rem/);
  assert.match(css, /min-height:\s*2\.75rem/);
  assert.match(css, /@media\s*\(min-width:\s*40rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(css, /@media\s*\(min-width:\s*80rem\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /#d8f16b/i);
});
