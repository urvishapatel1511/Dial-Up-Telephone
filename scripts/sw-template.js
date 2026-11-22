/* Dial-Up Telephone service worker. Generated at build time from scripts/sw-template.js. */
/* global self, caches, fetch, URL */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const PREFIX = 'dialup-';
/** Caches of the builds before update prompts existed (they took over without asking). */
const LEGACY_PREFIX = 'ghostfreq-';
const CACHE = PREFIX + VERSION;
const scope = self.registration.scope;
const ROOT = new URL('./', scope).href;
const urls = [ROOT, ...FILES.map((f) => new URL(f, scope).href)];

// A new version downloads and waits. The page shows "Update available" and
// activates it only when the player taps "Reload to update", so a round in
// progress is never interrupted. (The first install has nothing to wait for.)
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(urls);
      // One-time move from the old builds: their pages can't show the update prompt.
      const keys = await caches.keys();
      if (keys.some((k) => k.startsWith(LEGACY_PREFIX))) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith(PREFIX) || k.startsWith(LEGACY_PREFIX)) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first for our own files. Navigations fall back to the cached page when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.url.endsWith('/precache.json')) return; // always ask the network, so "Prepare" sees the newest build
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') {
          const page = await cache.match(ROOT);
          if (page) return page;
        }
        throw err;
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: VERSION });
  // Sent only when the player taps "Reload to update".
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});
