import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReadiness } from "../scripts/release-live-check.mjs";
import { readFile } from "node:fs/promises";

const successfulProbe = { reachable: true, status: 200, location: null, contentType: "application/json", body: "" };

test("release live check only passes when DNS, HTTPS, PWA and API are all ready", () => {
  const result = evaluateReadiness({
    dnsRecords: [
      { type: "NS", ready: true },
      { type: "A", ready: true },
      { type: "AAAA", ready: false },
      { type: "CNAME", ready: false },
    ],
    http: { reachable: true, status: 301, location: "https://daofazuoye.cn/" },
    homepage: { ...successfulProbe, contentType: "text/html" },
    manifest: { ...successfulProbe, contentType: "application/manifest+json", body: '{"start_url":"/","display":"standalone"}' },
    session: { ...successfulProbe, status: 401 },
    miniLogin: { ...successfulProbe, status: 401 },
  });

  assert.equal(result.liveReady, true);
  assert.equal(result.checks.length, 7);
});

test("an HTML 403 challenge never counts as an online session API", () => {
  const result = evaluateReadiness({
    dnsRecords: [{ type: "NS", ready: true }, { type: "A", ready: true }],
    http: { reachable: true, status: 302, location: "https://daofazuoye.cn/" },
    homepage: { reachable: true, status: 403, contentType: "text/html" },
    manifest: { reachable: true, status: 403, contentType: "text/html", body: "<title>Attention Required!</title>" },
    session: { reachable: true, status: 403, contentType: "text/html", body: "" },
    miniLogin: { reachable: true, status: 403, contentType: "text/html", body: "" },
  });

  assert.equal(result.liveReady, false);
  assert.equal(result.checks.find((item) => item.name === "会话接口").ready, false);
  assert.match(result.checks.find((item) => item.name === "会话接口").detail, /安全挑战/);
  assert.equal(result.checks.find((item) => item.name === "小程序登录入口").ready, false);
});

test("registered nameservers do not hide a missing website address record", () => {
  const result = evaluateReadiness({
    dnsRecords: [
      { type: "NS", ready: true },
      { type: "A", ready: false },
      { type: "AAAA", ready: false },
      { type: "CNAME", ready: false },
    ],
    http: { reachable: false, status: null, location: null },
    homepage: { reachable: false, status: null },
    manifest: { reachable: false, status: null, body: "" },
    session: { reachable: false, status: null },
    miniLogin: { reachable: false, status: null },
  });

  assert.equal(result.liveReady, false);
  assert.equal(result.checks.find((item) => item.name === "权威 DNS").ready, true);
  assert.equal(result.checks.find((item) => item.name === "网站地址记录").ready, false);
});

test("production probe uses browser and WeChat identities without accepting HTML challenges", async () => {
  const source = await readFile(new URL("../scripts/release-live-check.mjs", import.meta.url), "utf8");
  assert.match(source, /options\.userAgent \|\| "Mozilla\/5\.0/);
  assert.match(source, /MicroMessenger\/8\.0\.50 ZhishiReleaseReadiness\/2\.0/);
  assert.match(source, /targets\.apiOrigin/);
  assert.match(source, /new URL\("\/api\/v2\/mini\/login", apiOrigin\)/);
  assert.match(source, /status === 403\s*&& \/text\\\/html\/i/);
  assert.match(source, /requestWithSystemNetwork\(url, options\)/);
  assert.match(source, /catch \{\s*return requestWithSystemNetwork\(url, options\);\s*\}/);
  assert.match(source, /transport: "system-network-fallback"/);
});
