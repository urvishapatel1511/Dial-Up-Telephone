import { defineConfig } from 'vitest/config';

// Browser screenshot checks (Microsoft Edge via playwright-core). Run: npm.cmd run screens
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-browser/**/*.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
