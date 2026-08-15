const MINI_API_PREFIX = "/api/v2/mini/";

function rewriteLocation(location, upstreamOrigin, publicOrigin) {
  if (!location) return location;
  const target = new URL(location, upstreamOrigin);
  if (target.origin !== upstreamOrigin) return location;
  return `${publicOrigin}${target.pathname}${target.search}${target.hash}`;
}

const worker = {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, env.UPSTREAM_ORIGIN);
    const upstreamOrigin = new URL(env.UPSTREAM_ORIGIN).origin;
    const isMiniApi = incoming.pathname.startsWith(MINI_API_PREFIX);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("x-forwarded-for");
    if (isMiniApi) headers.set("accept", headers.get("accept") || "application/json");
    headers.set("oai-sites-authorization", `Bearer ${env.UPSTREAM_BYPASS_TOKEN}`);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));
    headers.set("x-zhishi-edge", isMiniApi ? "mini-v2" : "web-v2");

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    const outgoing = new Headers(response.headers);
    if (isMiniApi) {
      outgoing.delete("set-cookie");
      outgoing.set("cache-control", "private, no-store");
    }
    const location = rewriteLocation(outgoing.get("location"), upstreamOrigin, incoming.origin);
    if (location) outgoing.set("location", location);
    outgoing.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers: outgoing });
  },
};

export default worker;
