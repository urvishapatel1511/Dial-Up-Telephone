import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, isPrecached, missingRequired, verifyEntries } from '../src/offline/precache';

const enc = new TextEncoder();
const file = (path: string, text: string) => ({ path, bytes: enc.encode(text) });
const site = () => [
  file('index.html', '<html>'),
  file('assets/index-abc.js', 'js'),
  file('assets/index-abc.css', 'css'),
  file('vendor/ggwave.js', 'wasm'),
];

describe('precache manifest (R6.1)', () => {
  it('lists every built file with its size, in a stable order', () => {
    const m = buildManifest(site().reverse());
    expect(m.files).toEqual([
      { url: 'assets/index-abc.css', size: 3 },
      { url: 'assets/index-abc.js', size: 2 },
      { url: 'index.html', size: 6 },
      { url: 'vendor/ggwave.js', size: 4 },
    ]);
    expect(missingRequired(m)).toEqual([]);
  });

  it('never caches the service worker, the manifest, source maps, or dotfiles', () => {
    expect(isPrecached('sw.js')).toBe(false);
    expect(isPrecached('precache.json')).toBe(false);
    expect(isPrecached('assets/index.js.map')).toBe(false);
    expect(isPrecached('.nojekyll')).toBe(false);
    expect(isPrecached('assets/index.js')).toBe(true);
  });

  it('normalizes Windows paths', () => {
    expect(buildManifest([file('vendor\\ggwave.js', 'x')]).files[0].url).toBe('vendor/ggwave.js');
  });

  it('the version changes when any byte changes, and only then', () => {
    const a = buildManifest(site());
    expect(buildManifest(site()).version).toBe(a.version);
    const changed = site();
    changed[3] = file('vendor/ggwave.js', 'wasn');
    expect(buildManifest(changed).version).not.toBe(a.version);
  });

  it('a build without the audio engine or the page is reported as broken', () => {
    const m = buildManifest(site().filter((f) => f.path !== 'vendor/ggwave.js'));
    expect(missingRequired(m)).toEqual(['vendor/ggwave.js']);
    expect(missingRequired(buildManifest([]))).toEqual(['index.html', 'vendor/ggwave.js', 'assets/*.js', 'assets/*.css']);
  });
});

describe('verifying the cache before saying "ready" (R6.1)', () => {
  const m = buildManifest(site());

  it('confirms only when every entry is present with the right size', async () => {
    const sizes = new Map(m.files.map((f) => [f.url, f.size]));
    const r = await verifyEntries(m, async (u) => sizes.get(u) ?? null);
    expect(r).toMatchObject({ ok: true, checked: 4, bytes: 15, missing: [], wrongSize: [] });
  });

  it('a missing file blocks confirmation', async () => {
    const r = await verifyEntries(m, async (u) => (u === 'vendor/ggwave.js' ? null : m.files.find((f) => f.url === u)!.size));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['vendor/ggwave.js']);
  });

  it('a truncated file blocks confirmation', async () => {
    const r = await verifyEntries(m, async (u) => (u === 'index.html' ? 1 : m.files.find((f) => f.url === u)!.size));
    expect(r.ok).toBe(false);
    expect(r.wrongSize).toEqual(['index.html']);
  });

  it('an empty manifest is never "ready"', async () => {
    expect((await verifyEntries({ version: 'x', files: [] }, async () => 0)).ok).toBe(false);
  });
});

describe('no third-party runtime origins (R6.3)', () => {
  it('index.html loads only local scripts and styles', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/(src|href)\s*=\s*["'](https?:)?\/\//i);
  });

  it('app code never fetches a remote URL', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of [...walk('src'), 'scripts/sw-template.js']) {
      // The SVG XML namespace is an identifier, never fetched.
      const code = readFileSync(f, 'utf8').split("'http://www.w3.org/2000/svg'").join("'svg-ns'");
      expect(code, f).not.toMatch(/["'`]https?:\/\//);
    }
  });
});

describe.skipIf(!existsSync('dist/precache.json'))('the last production build (dist/)', () => {
  it('precache.json and sw.js list exactly the files in dist, with the right sizes', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const onDisk = buildManifest(walk('dist').map((p) => ({ path: relative('dist', p), bytes: readFileSync(p) })));
    const written = JSON.parse(readFileSync('dist/precache.json', 'utf8'));
    expect(written).toEqual(onDisk);
    const sw = readFileSync('dist/sw.js', 'utf8');
    expect(sw).toContain(JSON.stringify(onDisk.version));
    for (const f of onDisk.files) expect(sw).toContain(JSON.stringify(f.url));
  });
});
