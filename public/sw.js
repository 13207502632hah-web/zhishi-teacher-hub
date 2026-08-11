const VERSION = "zhishi-pwa-v2-2";
const STATIC = ["/offline-record.html", "/app-icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname.startsWith("/v2/record") ? "/offline-record.html" : "/offline-record.html")));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v2/")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response.ok && ["style", "script", "font", "image"].includes(request.destination)) caches.open(VERSION).then((cache) => cache.put(request, response.clone())); return response; })));
});
