import assert from "node:assert/strict";
import test from "node:test";

import worker from "../mini-edge/worker.js";

test("mini edge only forwards the versioned mini API and strips edge identity headers", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return Response.json({ error: "invalid code" }, { status: 401, headers: { "set-cookie": "private=1" } });
  };
  try {
    const response = await worker.fetch(new Request("https://edge.test/api/v2/mini/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
      body: JSON.stringify({ code: "probe" }),
    }), {
      UPSTREAM_ORIGIN: "https://upstream.test",
      UPSTREAM_BYPASS_TOKEN: "secret-token",
    });
    assert.equal(response.status, 401);
    assert.equal(forwarded.url, "https://upstream.test/api/v2/mini/login");
    assert.equal(forwarded.init.headers.get("cf-connecting-ip"), null);
    assert.equal(forwarded.init.headers.get("oai-sites-authorization"), "Bearer secret-token");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mini edge rejects every non-mini route without contacting upstream", async () => {
  const response = await worker.fetch(new Request("https://edge.test/api/session"), {});
  assert.equal(response.status, 404);
});
