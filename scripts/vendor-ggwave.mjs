// Copies the ggwave browser build (WASM embedded) into public/vendor so it is
// served from our own origin and can be cached for offline play.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = require.resolve('ggwave/ggwave.js');
const outDir = join(root, 'public', 'vendor');

mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'ggwave.js'));
console.log(`vendored ${src} -> public/vendor/ggwave.js`);
