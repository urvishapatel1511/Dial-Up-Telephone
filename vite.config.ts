import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { offlinePlugin } from './scripts/offline-plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Short commit of the build, so players can compare phones. Empty outside a git checkout. */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

// `--mode https` turns on a self-signed certificate so phones on the LAN
// get a secure context (required for getUserMedia).
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(gitCommit()),
  },
  plugins: [...(mode === 'https' ? [basicSsl()] : []), offlinePlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
}));
