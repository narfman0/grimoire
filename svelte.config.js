import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// To deploy to Vercel later, replace the import above with:
//   import adapter from '@sveltejs/adapter-vercel';
// and `pnpm add -D @sveltejs/adapter-vercel`. Note: the sync-server
// (Hocuspocus) cannot run on Vercel serverless — it needs a long-lived
// connection. Keep it on srv (or another always-on host) regardless.

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
};

export default config;
