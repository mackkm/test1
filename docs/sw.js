/* PocketClaw service worker — caches the app shell so it opens instantly
 * and works offline (API calls always go to the network). */

const CACHE = "pocketclaw-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept API traffic — only same-origin GET app-shell requests
  // (the PocketClaw gateway serves /api/* from this same origin).
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/api/")) return;
  // Stale-while-revalidate: serve the cached shell instantly for a fast open,
  // but always kick off a network fetch that refreshes the cache. This way a
  // new deploy reaches installed users on the *next* load even if sw.js (the
  // CACHE version) wasn't bumped — no more permanently stale app code.
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((hit) => {
        const network = fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    )
  );
});
