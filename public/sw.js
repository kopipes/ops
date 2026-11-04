/**
 * Pulse service worker (§9.4 — "PWA, offline shell").
 *
 * Deliberately conservative. The app is server-rendered and permission-scoped,
 * so caching pages would risk showing stale or wrong-user data. What it caches:
 *
 *  - the app shell assets (icons, manifest) so the PWA is installable and loads
 *    instantly;
 *  - a static /offline.html fallback for navigations that fail.
 *
 * It NEVER caches: HTML pages, API responses, or photos — those must always hit
 * the server so permissions and fresh data are respected.
 */
const VERSION = "pulse-v1";
const SHELL = `${VERSION}-shell`;
const SHELL_ASSETS = ["/icon.svg", "/manifest.webmanifest", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only same-origin.
  if (url.origin !== self.location.origin) return;

  // Never intercept API, auth, print or photo routes.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/print/") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return;
  }

  // Shell assets: cache-first.
  if (SHELL_ASSETS.some((a) => url.pathname === a)) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  // Navigations: network-only, with an offline fallback page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html").then((cached) => cached ?? Response.error()),
      ),
    );
  }
});
