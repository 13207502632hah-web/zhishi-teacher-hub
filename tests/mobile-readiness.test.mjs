import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

test("mobile readiness audit passes local implementation without claiming external completion", () => {
  const result = spawnSync(process.execPath, ["scripts/mobile-readiness.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(path.join(ROOT, ".artifacts/mobile/readiness.json"), "utf8"));
  assert.equal(report.localReady, true);
  assert.equal(report.productionReady, report.localReady && report.externalReady);
  assert.equal(report.boundaries.deployed, false);
  assert.equal(report.boundaries.wechatUploaded, false);
  assert.equal(report.boundaries.appStoreSubmitted, false);
  assert.ok(report.external.length >= 7);
  assert.equal(report.boundaries.realDeviceTestedByThisCommand, false);
});
