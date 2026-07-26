import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// adapter-node because prod is a single always-on Fly machine: better-sqlite3
// opens a local file, the session GC + graceful shutdown live in-process, and
// migrations run at container boot — none of which fits serverless.

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
};

export default config;
