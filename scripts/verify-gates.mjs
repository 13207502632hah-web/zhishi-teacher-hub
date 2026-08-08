#!/usr/bin/env node
// Reproducible gate runner for production release evidence.
//
// Runs the exact command sequence used for release verification and writes an
// evidence JSON to outputs/gates-<sha>.json. Any failing gate stops the run
// with a non-zero exit code, mirroring CI behavior.
//
// Usage (Node 22):
//   npx -y node@22 scripts/verify-gates.mjs
//   npx -y node@22 scripts/verify-gates.mjs --skip teaching:e2e,surface

import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
// The repository has no pnpm bin in node_modules/.bin. Resolve the npm-bundled
// npx CLI and run it under the current (Node 22) runtime with pnpm 11, the
// same major version used to generate the lockfile.
function resolveNpxCli() {
  if (process.platform === "win32") {
    const where = execFileSync("where.exe", ["npx.cmd"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    return path.join(path.dirname(where), "node_modules", "npm", "bin", "npx-cli.js");
  }
  const which = execFileSync("which", ["npx"], { encoding: "utf8" }).trim();
  return path.join(path.dirname(which), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");
}
const pnpm = process.execPath;
const pnpmArgs = [resolveNpxCli(), "--yes", "pnpm@11.16.0"];
const nodeRuntime = process.execPath;
const nodeVersion = process.version;
const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const reportPath = path.join(root, "outputs", `gates-${gitSha.slice(0, 12)}.json`);

const skipArg = process.argv.find((arg) => arg.startsWith("--skip="));
const skipped = new Set(skipArg ? skipArg.slice("--skip=".length).split(",").filter(Boolean) : []);

const gates = [
  { name: "typecheck", command: nodeRuntime, args: ["node_modules/typescript/bin/tsc", "--noEmit"], parse: false },
  { name: "lint", command: nodeRuntime, args: ["node_modules/eslint/bin/eslint.js", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", "--ignore-pattern", ".artifacts", "--ignore-pattern", "public/ocr"], parse: false },
  { name: "test", command: pnpm, args: [...pnpmArgs, "test"], parse: true },
  { name: "build", command: pnpm, args: [...pnpmArgs, "build"], parse: false },
  { name: "teaching:e2e", command: nodeRuntime, args: ["scripts/teaching-loop-e2e.mjs"], parse: false },
  { name: "surface", command: nodeRuntime, args: ["scripts/surface-audit.mjs"], parse: false },
  { name: "api:inventory", command: nodeRuntime, args: ["scripts/api-inventory.mjs", "--strict"], parse: false },
];

const runCommand = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const output = { stdout: "", stderr: "" };
    child.stdout.on("data", (chunk) => { output.stdout += chunk; });
    child.stderr.on("data", (chunk) => { output.stderr += chunk; });
    child.on("error", (error) => {
      resolve({ ok: false, code: null, signal: null, output, error: String(error) });
    });
    child.on("close", (code, signal) => {
      resolve({ ok: code === 0, code, signal, output });
    });
  });

function parseTestStats(output) {
  const combined = `${output.stdout}\n${output.stderr}`;
  const passMatch = combined.match(/(\d+)\s+pass/);
  const failMatch = combined.match(/(\d+)\s+fail/);
  const skipMatch = combined.match(/(\d+)\s+skipped?/);
  const testsMatch = combined.match(/(?:#\s+tests\s+(\d+)|tests\s+(\d+)\s+\/)/);
  return {
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
    skip: skipMatch ? Number(skipMatch[1]) : null,
    tests: testsMatch ? Number(testsMatch[1] ?? testsMatch[2]) : null,
  };
}

async function main() {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const results = [];
  const startedAt = new Date().toISOString();
  let overallOk = true;

  for (const gate of gates) {
    if (skipped.has(gate.name)) {
      results.push({ name: gate.name, skipped: true });
      console.log(`[skip] ${gate.name}`);
      continue;
    }
    const started = Date.now();
    console.log(`[run] ${gate.name} ...`);
    const result = await runCommand(gate.command, gate.args);
    const durationMs = Date.now() - started;
    const record = {
      name: gate.name,
      ok: result.ok,
      code: result.code,
      signal: result.signal,
      durationMs,
      error: result.error || null,
      stats: gate.parse ? parseTestStats(result.output) : null,
      outputTail: `${result.output.stdout}\n${result.output.stderr}`.trim().slice(-4000),
    };
    results.push(record);
    if (!result.ok) {
      overallOk = false;
      console.log(`[FAIL] ${gate.name} (exit ${result.code ?? "error"})`);
      console.log(record.outputTail.slice(-2000));
      break;
    }
    console.log(`[ok] ${gate.name} (${durationMs} ms)${record.stats?.pass ? `, ${record.stats.pass} pass` : ""}`);
  }

  const report = {
    ok: overallOk,
    generatedAt: new Date().toISOString(),
    startedAt,
    node: nodeVersion,
    nodeMajor: Number(nodeVersion.match(/^v(\d+)/)?.[1]),
    git: { sha: gitSha, short: gitSha.slice(0, 12) },
    command: "npx -y node@22 scripts/verify-gates.mjs",
    gates: results,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n门禁结果：${overallOk ? "PASS" : "FAIL"}；证据 ${path.relative(root, reportPath)}`);
  if (!overallOk) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
