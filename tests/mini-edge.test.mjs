import assert from "node:assert/strict";
import test from "node:test";

import worker from "../mini-edge/worker.js";

test("edge forwards the versioned mini API and strips edge identity headers", async () => {
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

test("edge forwards website routes, preserves cookies, and rewrites upstream redirects", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(null, {
      status: 302,
      headers: {
        location: "https://upstream.test/login?next=%2Frecord",
        "set-cookie": "teacher_session=private; Path=/; Secure; HttpOnly",
        "cache-control": "public, max-age=60",
      },
    });
  };
  try {
    const response = await worker.fetch(new Request("https://daofazuoye.cn/record"), {
      UPSTREAM_ORIGIN: "https://upstream.test",
      UPSTREAM_BYPASS_TOKEN: "secret-token",
    });
    assert.equal(forwarded.url, "https://upstream.test/record");
    assert.equal(forwarded.init.headers.get("x-forwarded-host"), "daofazuoye.cn");
    assert.equal(forwarded.init.headers.get("x-zhishi-edge"), "web-v2");
    assert.equal(response.headers.get("location"), "https://daofazuoye.cn/login?next=%2Frecord");
    assert.match(response.headers.get("set-cookie"), /teacher_session=private/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("edge leaves external redirects unchanged", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: "https://weixin.qq.com/" },
  });
  try {
    const response = await worker.fetch(new Request("https://daofazuoye.cn/login"), {
      UPSTREAM_ORIGIN: "https://upstream.test",
      UPSTREAM_BYPASS_TOKEN: "secret-token",
    });
    assert.equal(response.headers.get("location"), "https://weixin.qq.com/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
