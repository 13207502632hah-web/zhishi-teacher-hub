import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker from "../mini-api-edge/worker.js";

const env = {
  UPSTREAM_ORIGIN: "https://upstream.test",
  UPSTREAM_BYPASS_TOKEN: "server-only-secret",
};

test("mini API edge forwards only the versioned mini API with a server-side bypass", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return Response.json({ code: "WECHAT_LOGIN_FAILED" }, {
      status: 400,
      headers: { "set-cookie": "private=1" },
    });
  };
  try {
    const response = await worker.fetch(new Request("https://api.daofazuoye.cn/api/v2/mini/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "127.0.0.1",
        "oai-sites-authorization": "Bearer attacker-value",
      },
      body: JSON.stringify({ code: "probe" }),
    }), env);

    assert.equal(response.status, 400);
    assert.equal(forwarded.url, "https://upstream.test/api/v2/mini/login");
    assert.equal(forwarded.init.headers.get("cf-connecting-ip"), null);
    assert.equal(forwarded.init.headers.get("oai-sites-authorization"), "Bearer server-only-secret");
    assert.equal(forwarded.init.headers.get("x-zhishi-edge"), "mini-api-v2");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { code: "WECHAT_LOGIN_FAILED" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mini API edge rejects non-mini routes and unsupported methods without contacting upstream", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    const nonMini = await worker.fetch(new Request("https://api.daofazuoye.cn/api/session"), env);
    const unsupported = await worker.fetch(new Request("https://api.daofazuoye.cn/api/v2/mini/login", { method: "PUT" }), env);
    assert.equal(nonMini.status, 404);
    assert.equal(unsupported.status, 405);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client API edge also serves the configured iOS mobile API without opening website routes", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return Response.json({ records: [] });
  };
  try {
    const response = await worker.fetch(new Request("https://api.daofazuoye.cn/api/v2/mobile/records"), env);
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, "https://upstream.test/api/v2/mobile/records");
    assert.equal(forwarded.init.headers.get("x-zhishi-edge"), "mobile-api-v2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mini API edge converts upstream HTML challenges and redirects into stable JSON errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<title>blocked</title>", { status: 403, headers: { "content-type": "text/html" } });
    const blocked = await worker.fetch(new Request("https://api.daofazuoye.cn/api/v2/mini/login", { method: "POST" }), env);
    assert.equal(blocked.status, 502);
    assert.equal((await blocked.json()).code, "MINI_UPSTREAM_NON_JSON");

    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://example.test/login" } });
    const redirected = await worker.fetch(new Request("https://api.daofazuoye.cn/api/v2/mini/login", { method: "POST" }), env);
    assert.equal(redirected.status, 502);
    assert.equal((await redirected.json()).code, "MINI_UPSTREAM_REDIRECT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mini API edge production config uses a dedicated API custom domain", async () => {
  const config = await readFile(new URL("../mini-api-edge/wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"name": "zhishi-mini-api"/);
  assert.match(config, /"pattern": "api\.daofazuoye\.cn"/);
  assert.match(config, /"custom_domain": true/);
  assert.match(config, /"workers_dev": false/);
  assert.doesNotMatch(config, /"pattern": "daofazuoye\.cn"/);
});
