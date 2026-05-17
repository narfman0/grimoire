import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
