const CLIENT_API_PREFIXES = ["/api/v2/mini/", "/api/v2/mobile/"];
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

function jsonError(status, error, code) {
  return Response.json({ error, code }, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function upstreamTarget(incoming, configuredOrigin) {
  const origin = new URL(configuredOrigin).origin;
  if (origin === incoming.origin) throw new Error("upstream loop");
  return new URL(`${incoming.pathname}${incoming.search}`, origin);
}

function upstreamHeaders(request, bypassToken, path) {
  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "oai-sites-authorization",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) headers.delete(name);
  headers.set("accept", "application/json");
  headers.set("oai-sites-authorization", `Bearer ${bypassToken}`);
  headers.set("x-zhishi-edge", path.startsWith("/api/v2/mini/") ? "mini-api-v2" : "mobile-api-v2");
  return headers;
}

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

const worker = {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!CLIENT_API_PREFIXES.some((prefix) => incoming.pathname.startsWith(prefix))) {
      return jsonError(404, "Not found", "MINI_EDGE_NOT_FOUND");
    }
    if (!ALLOWED_METHODS.has(request.method)) {
      return jsonError(405, "Method not allowed", "MINI_EDGE_METHOD_NOT_ALLOWED");
    }
    if (!env.UPSTREAM_ORIGIN || !env.UPSTREAM_BYPASS_TOKEN) {
      return jsonError(503, "小程序服务入口尚未完成配置", "MINI_EDGE_NOT_CONFIGURED");
    }

    let target;
    try {
      target = upstreamTarget(incoming, env.UPSTREAM_ORIGIN);
    } catch {
      return jsonError(503, "小程序服务入口配置异常", "MINI_EDGE_INVALID_UPSTREAM");
    }

    let response;
    try {
      response = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders(request, env.UPSTREAM_BYPASS_TOKEN, incoming.pathname),
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
    } catch {
      return jsonError(502, "小程序服务暂时不可用，请稍后重试", "MINI_UPSTREAM_UNAVAILABLE");
    }

    if (response.status >= 300 && response.status < 400) {
      return jsonError(502, "小程序服务返回了异常跳转", "MINI_UPSTREAM_REDIRECT");
    }
    const contentType = response.headers.get("content-type") || "";
    if (response.status >= 400 && !/application\/json/i.test(contentType)) {
      return jsonError(502, "小程序服务入口被上游拦截", "MINI_UPSTREAM_NON_JSON");
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(response),
    });
  },
};

export default worker;
