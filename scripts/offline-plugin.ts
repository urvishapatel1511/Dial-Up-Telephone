import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { buildManifest, missingRequired } from '../src/offline/precache';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * After `vite build`, lists every file in dist/ and writes:
 *  - precache.json: { version, files: [{ url, size }] }, used by "Prepare for offline play"
 *  - sw.js: the service worker with the same list baked in
 * The build fails if a file the game needs is missing.
 */
export function offlinePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dial-up-telephone-offline',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir).map((p) => ({ path: relative(outDir, p), bytes: readFileSync(p) }));
      const manifest = buildManifest(files);
      const missing = missingRequired(manifest);
      if (missing.length) throw new Error(`offline precache is missing: ${missing.join(', ')}`);
      const template = readFileSync(fileURLToPath(new URL('./sw-template.js', import.meta.url)), 'utf8');
      const sw = template.replace("'__VERSION__'", JSON.stringify(manifest.version)).replace('__FILES__', JSON.stringify(manifest.files.map((f) => f.url)));
      writeFileSync(join(outDir, 'sw.js'), sw);
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify(manifest, null, 2));
      const kb = (manifest.files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(0);
      console.log(`offline: ${manifest.files.length} files, ${kb} KB, version ${manifest.version}`);
    },
  };
}
