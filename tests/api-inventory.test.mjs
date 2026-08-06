import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = process.cwd();
const reportPath = path.join(root, "outputs", "api-inventory.json");

test("api inventory script lists every route with methods and test references", async () => {
  const { stdout } = await run(process.execPath, ["scripts/api-inventory.mjs"], { cwd: root });
  const report = JSON.parse(await readFile(reportPath, "utf8"));

  assert.equal(report.summary.totalRoutes, report.routes.length);
  assert.ok(report.routes.length >= 100, `expected at least 100 routes, got ${report.routes.length}`);
  assert.ok(report.summary.coveredRoutes > 0, "expected at least one covered route");
  assert.equal(
    report.summary.coveredRoutes + report.summary.uncoveredRoutes,
    report.summary.totalRoutes,
    "covered + uncovered must equal the route total",
  );
  assert.ok(report.summary.appOnlyRoutes <= report.summary.uncoveredRoutes);
  for (const route of report.routes) {
    assert.ok(route.file.startsWith("app/api/"), route.file);
    assert.ok(route.path.startsWith("/api/"), route.path);
    assert.ok(Array.isArray(route.methods) && route.methods.length > 0, route.file);
    assert.ok(Array.isArray(route.references));
    assert.ok(Array.isArray(route.appReferences));
  }
  assert.ok(report.referenceSources.some((source) => source.startsWith("tests/")));
  assert.match(stdout, /API 清单与测试引用/);
  assert.match(stdout, /未覆盖/);
});

test("api inventory strict mode fails when uncovered routes remain", async () => {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report.summary.uncoveredRoutes > 0) {
    await assert.rejects(
      run(process.execPath, ["scripts/api-inventory.mjs", "--strict"], { cwd: root }),
      (error) => error.code === 1,
    );
  } else {
    await run(process.execPath, ["scripts/api-inventory.mjs", "--strict"], { cwd: root });
  }
});
