import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generatedSources, normalizeRootDomain, releaseTarget } from "../scripts/configure-release-domain.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("one root domain deterministically configures website mini and iOS", async () => {
  const target = releaseTarget("Example.CN");
  assert.deepEqual(target, { rootDomain: "example.cn", webOrigin: "https://example.cn", apiOrigin: "https://example.cn" });
  const generated = generatedSources(target);
  assert.match(generated.manifest, /https:\/\/example\.cn/);
  assert.match(generated.mini, /configured: true/);
  assert.match(generated.ios, /static let configured = true/);

  const [layout, miniConfig, iosApp, packageJson] = await Promise.all([
    read("app/layout.tsx"), read("mini-program/config.js"), read("ios/ZhishiMobile/ZhishiMobileApp.swift"), read("package.json"),
  ]);
  assert.match(layout, /RELEASE_METADATA_BASE/);
  assert.match(miniConfig, /releaseTarget\.apiOrigin/);
  assert.match(iosApp, /ReleaseTarget\.apiBaseURL/);
  assert.equal(typeof JSON.parse(packageJson).scripts["release:domain"], "string");
});

test("release domain validation rejects URLs subdomains IPs and placeholders", () => {
  assert.equal(normalizeRootDomain("知师研室.cn"), "xn--wbt98cr92bofa.cn");
  for (const invalid of ["", "https://example.cn", "www.example.cn", "api.example.cn", "127.0.0.1", "localhost", "example.invalid", "example.cn/path", "example.cn:443"]) {
    assert.throws(() => normalizeRootDomain(invalid), invalid);
  }
});

test("checked-in release targets remain synchronized while no domain is selected", async () => {
  const manifest = JSON.parse(await read("release-target.json"));
  const expected = generatedSources(releaseTarget(manifest.rootDomain));
  assert.equal(await read("release-target.json"), expected.manifest);
  assert.equal(await read("mini-program/release-target.js"), expected.mini);
  assert.equal(await read("ios/ZhishiMobile/ReleaseTarget.swift"), expected.ios);
});
