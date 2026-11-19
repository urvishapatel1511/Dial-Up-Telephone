/**
 * Pure helpers for offline play (R6). Used by the build plugin (to write
 * precache.json and sw.js) and by the page (to verify the cache).
 */

export interface PrecacheEntry {
  url: string;
  size: number;
}

export interface PrecacheManifest {
  version: string;
  files: PrecacheEntry[];
}

/** Files the service worker must never cache (itself and the manifest). */
export function isPrecached(path: string): boolean {
  return !/(^|\/)(sw\.js|precache\.json)$/.test(path) && !path.endsWith('.map') && !/(^|\/)\./.test(path);
}

/** FNV-1a 32-bit, enough to detect any change between builds. */
function fnv1a(hash: number, bytes: Uint8Array): number {
  let h = hash;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic manifest: same files and bytes → same version. */
export function buildManifest(files: { path: string; bytes: Uint8Array }[]): PrecacheManifest {
  const kept = files
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, '/') }))
    .filter((f) => isPrecached(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let h = 0x811c9dc5;
  const enc = new TextEncoder();
  for (const f of kept) {
    h = fnv1a(h, enc.encode(f.path + '\0'));
    h = fnv1a(h, f.bytes);
  }
  return {
    version: h.toString(16).padStart(8, '0'),
    files: kept.map((f) => ({ url: f.path, size: f.bytes.byteLength })),
  };
}

export const cacheName = (version: string) => `ghostfreq-${version}`;

export interface VerifyResult {
  ok: boolean;
  checked: number;
  bytes: number;
  missing: string[];
  wrongSize: string[];
}

/**
 * Checks every manifest entry. `lookup` returns the cached byte length,
 * or null if the entry is missing. Confirmation requires every entry (R6.1).
 */
export async function verifyEntries(
  manifest: PrecacheManifest,
  lookup: (url: string) => Promise<number | null>,
): Promise<VerifyResult> {
  const missing: string[] = [];
  const wrongSize: string[] = [];
  let bytes = 0;
  for (const f of manifest.files) {
    const size = await lookup(f.url);
    if (size === null) missing.push(f.url);
    else if (size !== f.size) wrongSize.push(f.url);
    else bytes += size;
  }
  return {
    ok: manifest.files.length > 0 && missing.length === 0 && wrongSize.length === 0,
    checked: manifest.files.length,
    bytes,
    missing,
    wrongSize,
  };
}

/** Files the game cannot start without. A manifest missing any of these is broken. */
export const REQUIRED = ['index.html', 'vendor/ggwave.js'];

export function missingRequired(manifest: PrecacheManifest): string[] {
  const urls = manifest.files.map((f) => f.url);
  const missing = REQUIRED.filter((r) => !urls.includes(r));
  if (!urls.some((u) => /^assets\/.+\.js$/.test(u))) missing.push('assets/*.js');
  if (!urls.some((u) => /^assets\/.+\.css$/.test(u))) missing.push('assets/*.css');
  return missing;
}
