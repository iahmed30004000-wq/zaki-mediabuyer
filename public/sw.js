/*
 * The Media Buyer's service worker (spec 18.5 «PWA قابل للتثبيت وآخر تقرير بلا نت»).
 * Pages: network first; each page that opened is kept, so without internet the last version opens — and the reports
 * page (the last report) is the fallback for any page never opened. Built files: cache first. The API, the login and
 * anything that changes data are never cached or replayed: an approval needs the internet, always.
 */
const VERSION = "mb-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/offline"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/login")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // a page that redirected to the door is not kept (signed out = nothing to show offline)
          if (res.ok && !res.redirected) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/reports")) || (await caches.match("/offline"))),
    );
  }
});
