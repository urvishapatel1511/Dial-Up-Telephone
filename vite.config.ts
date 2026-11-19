import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { offlinePlugin } from './scripts/offline-plugin';

// `--mode https` turns on a self-signed certificate so phones on the LAN
// get a secure context (required for getUserMedia).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [...(mode === 'https' ? [basicSsl()] : []), offlinePlugin()],
  server: { port: 5173 },
  preview: { port: 4173 },
}));
