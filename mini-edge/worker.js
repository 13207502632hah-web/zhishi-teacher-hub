const ALLOWED_PREFIX = "/api/v2/mini/";

const worker = {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith(ALLOWED_PREFIX)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const upstream = new URL(incoming.pathname + incoming.search, env.UPSTREAM_ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("x-forwarded-for");
    headers.set("accept", headers.get("accept") || "application/json");
    headers.set("oai-sites-authorization", `Bearer ${env.UPSTREAM_BYPASS_TOKEN}`);
    headers.set("x-zhishi-edge", "mini-v2");

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    const outgoing = new Headers(response.headers);
    outgoing.delete("set-cookie");
    outgoing.set("cache-control", "private, no-store");
    outgoing.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers: outgoing });
  },
};

export default worker;
