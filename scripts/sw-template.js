/* Ghost Frequency service worker. Generated at build time from scripts/sw-template.js. */
/* global self, caches, fetch, URL */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = 'ghostfreq-' + VERSION;
const scope = self.registration.scope;
const ROOT = new URL('./', scope).href;
const urls = [ROOT, ...FILES.map((f) => new URL(f, scope).href)];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(urls))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ghostfreq-') && k !== CACHE).map((k) => caches.delete(k))))
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
});
