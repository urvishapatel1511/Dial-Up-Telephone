import { cacheName, verifyEntries, type PrecacheManifest, type VerifyResult } from './precache';

export type PrepareResult =
  | { ok: true; result: VerifyResult; version: string }
  | { ok: false; reason: string };

const READY_KEY = 'ghostfreq:offline-ready';

/**
 * Registers the service worker on the published site only (dev uses an
 * untrusted certificate). `onUpdateReady` is called when a new version has
 * downloaded and is waiting; its argument activates it and reloads the page.
 * Nothing reloads unless that function is called (by the player's tap).
 */
export function registerServiceWorker(onUpdateReady?: (apply: () => void) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const notify = () => {
        const waiting = reg.waiting;
        // Without a controller this is the first install: nothing to update.
        if (waiting && navigator.serviceWorker.controller) onUpdateReady?.(() => applyUpdate(waiting));
      };
      notify();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && notify());
      });
      // A game night lasts hours: look for a new version when the page comes back, if online.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) reg.update().catch(() => undefined);
      });
    })
    .catch(() => {
      /* reported when the player taps Prepare */
    });
}

let reloading = false;
function reloadOnce() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

/** Activate the waiting version, then reload into it. */
function applyUpdate(waiting: ServiceWorker): void {
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
  waiting.postMessage({ type: 'skip-waiting' });
  // If the switch is slow, reload anyway: the page then loads from the new worker.
  setTimeout(reloadOnce, 4000);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * "Prepare for offline play": make sure every file is in the cache, then
 * verify each one (present and the right size) before saying yes (R6.1).
 */
export async function prepareOffline(onProgress: (text: string) => void): Promise<PrepareResult> {
  if (!import.meta.env.PROD) {
    return { ok: false, reason: 'Offline mode works on the published site (GitHub Pages), not on this test server.' };
  }
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    return { ok: false, reason: 'This browser cannot save the game for offline play. Try Chrome or Safari.' };
  }
  if (!navigator.onLine) return { ok: false, reason: 'Connect to Wi-Fi first, then tap Prepare again.' };

  onProgress('Starting the offline helper…');
  const reg = await withTimeout(navigator.serviceWorker.ready, 15_000);
  if (!reg) {
    return { ok: false, reason: 'The offline helper did not start. Make sure the address starts with https:// and reload.' };
  }

  onProgress('Checking the newest version…');
  let manifest: PrecacheManifest;
  try {
    const res = await fetch('./precache.json', { cache: 'no-store' });
    manifest = (await res.json()) as PrecacheManifest;
  } catch {
    return { ok: false, reason: 'Could not reach the site. Check Wi-Fi and try again.' };
  }

  const cache = await caches.open(cacheName(manifest.version));
  const root = new URL('./', location.href).href;
  let n = 0;
  for (const f of [{ url: '', size: -1 }, ...manifest.files]) {
    const url = new URL(f.url, root).href;
    if (!(await cache.match(url))) {
      onProgress(`Saving files… ${++n}`);
      try {
        await cache.add(url);
      } catch {
        return { ok: false, reason: `Could not save ${f.url || 'the page'}. Check Wi-Fi and try again.` };
      }
    }
  }

  onProgress('Verifying every file…');
  const result = await verifyEntries(manifest, async (u) => {
    const r = await cache.match(new URL(u, root).href);
    if (!r || !r.ok) return null;
    return (await r.clone().arrayBuffer()).byteLength;
  });
  const page = await cache.match(root);
  if (!result.ok || !page) {
    const bad = [...result.missing, ...result.wrongSize, ...(page ? [] : ['the page'])];
    return { ok: false, reason: `Some files did not save correctly (${bad.slice(0, 3).join(', ')}). Tap Prepare again.` };
  }
  if (!navigator.serviceWorker.controller) {
    return { ok: false, reason: 'Almost ready: reload this page once while online, then tap Prepare again.' };
  }
  localStorage.setItem(READY_KEY, manifest.version);
  return { ok: true, result, version: manifest.version };
}

/** True if this device prepared a version that is still cached. */
export async function isOfflineReady(): Promise<boolean> {
  const v = localStorage.getItem(READY_KEY);
  if (!v || !('caches' in window) || !navigator.serviceWorker?.controller) return false;
  return (await caches.keys()).includes(cacheName(v));
}
