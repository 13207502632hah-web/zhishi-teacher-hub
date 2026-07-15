import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("mini automation exposes one-command local workflows", async () => {
  const pkg = JSON.parse(await read("package.json"));
  for (const name of ["mini:prepare", "mini:dev", "mini:check", "mini:e2e", "mini:verify", "mini:preview"]) {
    assert.equal(typeof pkg.scripts[name], "string", `${name} script is required`);
  }
  assert.equal(pkg.devDependencies["miniprogram-automator"], "0.12.1");
});

test("automation is local-only by default and redacts runtime credentials", async () => {
  const source = await read("scripts/mini-automation.mjs");
  assert.match(source, /\.wrangler\/state\/v3\/d1/);
  assert.match(source, /0014_teacher_feedback_papers\.sql/);
  assert.match(source, /WECHAT_TEST_MODE=true/);
  assert.match(source, /未读取 \.env\.local/);
  assert.match(source, /Bearer \[REDACTED\]/);
  assert.match(source, /__e2e__/);
  assert.match(source, /cleanupFixtures/);
  assert.match(source, /args: \["--port", "9431"\]/);
  assert.match(source, /ws:\/\/127\.0\.0\.1:9420/);
  assert.match(source, /wechatUploaded: false/);
  assert.match(source, /reviewSubmitted: false/);
  assert.doesNotMatch(source, /\["upload"\s*,/);
});

test("preview requires a real app id, HTTPS staging and explicit confirmation", async () => {
  const source = await read("scripts/mini-automation.mjs");
  assert.match(source, /MINI_APP_ID/);
  assert.match(source, /MINI_STAGING_API_BASE/);
  assert.match(source, /MINI_PREVIEW_CONFIRMED/);
  assert.match(source, /YES_I_CONFIRMED/);
  assert.match(source, /DEVTOOLS_CLI, \["preview"/);
  assert.match(source, /未执行 upload、审核或发布/);
});

test("brand and local artifacts are configured safely", async () => {
  const [app, project, home, ignore] = await Promise.all([
    read("mini-program/app.json"),
    read("mini-program/project.config.json"),
    read("mini-program/pages/home/index.wxml"),
    read(".gitignore"),
  ]);
  assert.equal(JSON.parse(app).window.navigationBarTitleText, "来写作业吧");
  assert.equal(JSON.parse(project).projectname, "来写作业吧");
  assert.equal(JSON.parse(project).appid, "wxfec0f64566c68a2c");
  assert.equal(JSON.parse(project).setting.urlCheck, true);
  assert.equal(JSON.parse(project).libVersion, "3.15.2");
  assert.match(home, /来写作业吧/);
  for (const marker of [".dev.vars", "/.artifacts/", "private.*.key", "project.private.config.json"]) assert.ok(ignore.includes(marker), `${marker} must be ignored`);
});
