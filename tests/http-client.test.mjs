import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");

const loadHttpClient = async () => {
  const source = await readFile(new URL("../app/lib/http-client.ts", import.meta.url), "utf8");
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const evaluatedModule = { exports: {} };
  new Function("module", "exports", code)(evaluatedModule, evaluatedModule.exports);
  return evaluatedModule.exports;
};

const withMockFetch = async (fetchMock, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("requestJson returns a successful JSON response", async () => {
  const { requestJson } = await loadHttpClient();
  await withMockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), async () => {
    assert.deepEqual(await requestJson("/api/example"), { ok: true });
  });
});

test("requestJson returns null for 204 and empty successful bodies", async () => {
  const { requestJson } = await loadHttpClient();
  await withMockFetch(async () => new Response(null, { status: 204 }), async () => {
    assert.equal(await requestJson("/api/example"), null);
  });
  await withMockFetch(async () => new Response("", { status: 200 }), async () => {
    assert.equal(await requestJson("/api/example"), null);
  });
});

test("requestJson uses JSON API errors and stable status messages", async () => {
  const { HttpError, requestJson } = await loadHttpClient();
  await withMockFetch(async () => new Response(JSON.stringify({ error: "参数不正确" }), { status: 400 }), async () => {
    await assert.rejects(requestJson("/api/example"), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "参数不正确");
      assert.deepEqual(error.payload, { error: "参数不正确" });
      return true;
    });
  });
  for (const [status, message] of [[401, "登录状态已失效，请重新登录"], [403, "暂无权限执行此操作"]]) {
    await withMockFetch(async () => new Response(null, { status }), async () => {
      await assert.rejects(requestJson("/api/example"), (error) => error instanceof HttpError && error.status === status && error.message === message);
    });
  }
});

test("requestJson reports empty and HTML error bodies with stable messages", async () => {
  const { HttpError, requestJson } = await loadHttpClient();
  await withMockFetch(async () => new Response(null, { status: 500 }), async () => {
    await assert.rejects(requestJson("/api/example"), (error) => error instanceof HttpError && error.status === 500 && error.message === "服务器暂时无法处理请求，请稍后重试");
  });
  await withMockFetch(async () => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }), async () => {
    await assert.rejects(requestJson("/api/example"), (error) => error instanceof HttpError && error.status === 502 && error.message === "服务器暂时无法处理请求，请稍后重试");
  });
});

test("requestJson rejects non-JSON successful bodies", async () => {
  const { HttpError, requestJson } = await loadHttpClient();
  await withMockFetch(async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }), async () => {
    await assert.rejects(requestJson("/api/example"), (error) => error instanceof HttpError && error.status === 200 && error.message === "服务器返回了无法识别的数据");
  });
});

test("requestJson turns deadline and network failures into HttpError", async () => {
  const { HttpError, requestJson } = await loadHttpClient();
  await withMockFetch((_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }), async () => {
    await assert.rejects(requestJson("/api/example", { timeoutMs: 10 }), (error) => error instanceof HttpError && error.status === 0 && error.message === "请求超时，请稍后重试");
  });
  await withMockFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
    await assert.rejects(requestJson("/api/example"), (error) => error instanceof HttpError && error.status === 0 && error.message === "网络连接异常，请检查后重试");
  });
});

test("requestJson preserves a caller AbortSignal reason and can disable timeout", async () => {
  const { requestJson } = await loadHttpClient();
  const controller = new AbortController();
  const reason = new Error("由调用方取消");
  await withMockFetch((_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    setTimeout(() => controller.abort(reason), 5);
  }), async () => {
    await assert.rejects(requestJson("/api/example", { signal: controller.signal, timeoutMs: 0 }), (error) => error === reason);
  });
});
