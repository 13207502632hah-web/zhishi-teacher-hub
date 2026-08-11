import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReadiness } from "../scripts/release-live-check.mjs";

const successfulProbe = { reachable: true, status: 200, location: null, body: "" };

test("release live check only passes when DNS, HTTPS, PWA and API are all ready", () => {
  const result = evaluateReadiness({
    dnsRecords: [
      { type: "NS", ready: true },
      { type: "A", ready: true },
      { type: "AAAA", ready: false },
      { type: "CNAME", ready: false },
    ],
    http: { reachable: true, status: 301, location: "https://daofazuoye.cn/" },
    homepage: successfulProbe,
    manifest: { ...successfulProbe, body: '{"start_url":"/","display":"standalone"}' },
    session: { ...successfulProbe, status: 401 },
  });

  assert.equal(result.liveReady, true);
  assert.equal(result.checks.length, 6);
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
  });

  assert.equal(result.liveReady, false);
  assert.equal(result.checks.find((item) => item.name === "权威 DNS").ready, true);
  assert.equal(result.checks.find((item) => item.name === "网站地址记录").ready, false);
});
