import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load .env files (including the gitignored .env.local) so an operator can
  // override dev-server settings — most usefully `VITE_ALLOWED_HOSTS` — for
  // their local LAN setup without committing the hostname to the repo.
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = env.VITE_ALLOWED_HOSTS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    plugins: [tailwindcss(), sveltekit()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      ...(allowedHosts && allowedHosts.length > 0 ? { allowedHosts } : {})
    }
  };
});
