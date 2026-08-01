import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readOptional = async (path) => {
  try {
    return await read(path);
  } catch {
    return "";
  }
};

test("route state surfaces use isolated CSS and keep the global fallback safe", async () => {
  const [loading, error, notFound, globalError, styles] = await Promise.all([
    read("app/loading.tsx"),
    read("app/error.tsx"),
    read("app/not-found.tsx"),
    readOptional("app/global-error.tsx"),
    readOptional("app/route-states.module.css"),
  ]);

  assert.match(loading, /route-states\.module\.css/);
  assert.match(error, /route-states\.module\.css/);
  assert.match(notFound, /route-states\.module\.css/);
  assert.ok(globalError, "app/global-error.tsx must provide a root-layout fallback");
  assert.match(globalError, /route-states\.module\.css/);
  assert.match(styles, /\.routeState\b/);
  assert.match(styles, /prefers-reduced-motion\s*:\s*reduce/);
});

test("route errors expose safe recovery actions without rendering error details", async () => {
  const [error, globalError] = await Promise.all([
    read("app/error.tsx"),
    readOptional("app/global-error.tsx"),
  ]);

  assert.match(error, /reset/);
  assert.match(error, /typeof reset/);
  assert.match(error, /disabled=\{retrying\}/);
  assert.match(error, /正在重新加载/);
  assert.match(error, /href="\/workspace"/);
  assert.match(error, /href="\/"/);
  assert.doesNotMatch(error, /error\.(message|stack|digest)/);

  assert.match(globalError, /reset/);
  assert.match(globalError, /typeof reset/);
  assert.match(globalError, /disabled=\{retrying\}/);
  assert.match(globalError, /href="\/workspace"/);
  assert.match(globalError, /href="\/"/);
  assert.doesNotMatch(globalError, /error\.(message|stack|digest)/);
  assert.doesNotMatch(globalError, /JSON\.stringify|process\.env|request\./);
});

test("not-found keeps public and workspace recovery paths distinct", async () => {
  const notFound = await read("app/not-found.tsx");

  assert.match(notFound, /"use client"/);
  assert.match(notFound, /usePathname/);
  assert.match(notFound, /href="\/"/);
  assert.match(notFound, /href="\/resources"/);
  assert.match(notFound, /href="\/workspace"/);
  assert.match(notFound, /没有找到/);
  assert.doesNotMatch(notFound, /error\.(message|stack)|process\.env|JSON\.stringify/);
});

test("route state styles meet readable type, touch, fallback, and breakpoint requirements", async () => {
  const styles = await read("app/route-states.module.css");

  assert.match(styles, /font-size\s*:\s*1rem/);
  assert.match(styles, /font-size\s*:\s*0\.875rem/);
  assert.match(styles, /min-height\s*:\s*2\.75rem/);
  assert.match(styles, /min-width\s*:\s*2\.75rem/);
  assert.match(styles, /min-height\s*:\s*100dvh/);
  assert.match(styles, /@media\s*\(min-width\s*:\s*48rem\)/);
  assert.match(styles, /@media\s*\(min-width\s*:\s*64rem\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
  assert.doesNotMatch(styles, /animation[^:]*:\s*[^;]+infinite/);
});
