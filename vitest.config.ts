import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    // Component tests load the browser entry, not the SSR one.
    conditions: ['browser'],
    alias: {
      $lib: resolve(__dirname, 'src/lib')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Default Node env keeps the existing rules-engine + content-pack tests
    // fast; component tests opt into jsdom via the per-glob override.
    environment: 'node',
    environmentMatchGlobs: [
      ['src/lib/components/**', 'jsdom'],
      // encounter-channel guards on `typeof window !== 'undefined'` and uses
      // EventSource/fetch — needs the jsdom-backed window globals.
      ['src/lib/realtime/**/encounter-channel*', 'jsdom']
    ],
    setupFiles: ['./vitest.setup.ts'],
    globals: false
  }
});
