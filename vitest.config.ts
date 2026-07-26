import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Component tests load the browser entry, not the SSR one.
    conditions: ['browser'],
    alias: {
      $lib: resolve(__dirname, 'src/lib')
    }
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    // Vitest 3 removed `environmentMatchGlobs`; the node/jsdom split now
    // lives in two projects. Individual files outside components/ can still
    // opt into jsdom with a `// @vitest-environment jsdom` docblock (the
    // realtime channel tests do — they need window/EventSource globals).
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          // Default Node env keeps the rules-engine + content-pack tests fast.
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'src/lib/components/**']
        }
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/lib/components/**/*.test.ts']
        }
      }
    ]
  }
});
