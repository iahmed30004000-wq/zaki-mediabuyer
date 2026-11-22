/*
 * The Media Buyer's service worker (spec 18.5 «PWA قابل للتثبيت وآخر تقرير بلا نت») and, from v6 · P7, the one that receives the phone's notifications.
 *
 * Pages: network first; each page that opened is kept, so without internet the last version opens — and the results page (`/tasks/results`, the last reports) is the fallback for
 * any page never opened. Built files: cache first. The API, the login and anything that changes data are never cached or replayed: an approval needs the internet, always.
 *
 * The version is the deploy's: the page registers `/sw.js?v=<the image's version>`, so every deploy is a new worker whose first act is to drop the caches of the old one (N-15).
 * Signing out empties what was kept (S-23): a POST to the logout address clears every cache here, and the page can also send `{ type: "clear" }`.
 *
 * Push: `push` shows the notification from the payload (FCM's: `notification` for the text, `data.href` for the place) and puts the number of unread on the icon; a tap opens that place — or
 * focuses the tab that is open. There is NO Firebase library in here: the message arrives as JSON and this file only shows it. A tap never approves anything: it opens the decision.
 */
const V = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `mb-${V}`;
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const FALLBACK = "/tasks/results";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/offline"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/** Everything this worker kept, gone. */
async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  try {
    if (self.navigator && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {
    // no badge support
  }
}

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "clear") e.waitUntil(clearAll());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // signing out: what was kept for this person goes with the session (the request itself is left alone)
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    e.waitUntil(clearAll());
    return;
  }
  if (req.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/login")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // the copy is taken BEFORE the page reads the body (a clone made later is «already used» and nothing is ever kept)
            if (res.ok) {
              const copy = res.clone();
              e.waitUntil(caches.open(STATIC).then((c) => c.put(req, copy)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // a page that redirected to the door is not kept (signed out = nothing to show offline)
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            e.waitUntil(caches.open(PAGES).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(FALLBACK)) || (await caches.match("/offline"))),
    );
  }
});

// ─── push ───

/** An address inside the site, else the home: a notification never takes anyone to another site. */
function placeOf(href) {
  const h = typeof href === "string" ? href.trim() : "";
  return h.startsWith("/") && !h.startsWith("//") && !h.includes("\\") ? h.slice(0, 300) : "/";
}

async function showBadge() {
  try {
    if (!self.navigator || !self.navigator.setAppBadge) return;
    const r = await fetch("/api/notifications", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    const n = Math.max(0, Math.min(99, Number(j.unread) || 0));
    if (n > 0) await self.navigator.setAppBadge(n);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {
    // offline or signed out: the badge stays as it was
  }
}

self.addEventListener("push", (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = {};
  }
  const n = p.notification || {};
  const d = p.data || {};
  const title = typeof n.title === "string" && n.title ? n.title : "الميديا باير";
  const options = {
    body: typeof n.body === "string" ? n.body : "",
    icon: typeof n.icon === "string" && n.icon.startsWith(self.location.origin) ? n.icon : "/icons/icon-192.png",
    tag: typeof n.tag === "string" && n.tag ? n.tag : undefined,
    requireInteraction: n.requireInteraction === true,
    silent: n.silent === true,
    dir: "rtl",
    lang: "ar",
    data: { href: placeOf(d.href), id: typeof d.id === "string" ? d.id : "", kind: typeof d.kind === "string" ? d.kind : "" },
  };
  e.waitUntil(Promise.all([self.registration.showNotification(title, options), showBadge()]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(placeOf(data.href), self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (mine) {
        try {
          const focused = await mine.focus();
          if (focused && "navigate" in focused) await focused.navigate(target);
          return;
        } catch {
          // a window that cannot be driven: open one
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
