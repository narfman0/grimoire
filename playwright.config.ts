import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end smoke suite. Runs the *built* app (adapter-node output in
// build/) against a throwaway sqlite database, so a run can never touch
// grimoire.db. `pnpm build` must have been run first:
//
//   pnpm build && pnpm test:e2e
//
// The webServer command applies migrations to the throwaway DB and then
// boots `node build`. SRD content is seeded on first boot by
// hooks.server.ts (seedSrdIfMissing), so monster/class/species lookups
// work without extra setup.
//
// The DB path is minted once in the main runner process and pinned via an
// env var — Playwright worker processes re-evaluate this config file, and
// without the guard each worker would mkdtemp a fresh (unused) directory.
const dbDir =
  process.env.GRIMOIRE_E2E_DB_DIR ?? mkdtempSync(join(tmpdir(), 'grimoire-e2e-'));
process.env.GRIMOIRE_E2E_DB_DIR = dbDir;
const dbPath = join(dbDir, 'e2e.db');

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  // The realtime specs assert cross-client propagation within the 2s poll
  // interval; give expect() a bit more than one interval of headroom.
  expect: { timeout: 10_000 },
  timeout: 60_000,
  fullyParallel: false,
  // Specs share one server + one DB; usernames are unique per run, but keep
  // workers=1 so the realtime timing assertions stay deterministic. (The
  // auth rate limits used to be a second reason: every signup comes from
  // one loopback address, so the suite outgrew the 5/hour production
  // ceiling as specs were added. The webServer env below raises the
  // ceilings for the harness instead of capping how many accounts the
  // suite may create.)
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // The PWA service worker (src/service-worker.ts) caches page documents
    // and __data.json stale-while-revalidate; with it active, a reload can
    // render the previous cached state and assertions race the cache
    // instead of the app. Block it — the suite tests the app, not the SW.
    serviceWorkers: 'block'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/migrate.mjs && node build',
    url: BASE_URL,
    timeout: 60_000,
    // Never reuse a stray dev server — it would run against grimoire.db.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: dbPath,
      PORT: String(PORT),
      // adapter-node needs ORIGIN for correct origin checks on form POSTs.
      ORIGIN: BASE_URL,
      // Every request in the suite originates from one loopback address, so
      // the production per-IP auth ceilings (5 signups/hour, 5 logins/15min)
      // cap the whole run rather than any one client. Raise them here — the
      // limiters still run, they just aren't the thing under test. Keep these
      // well above the suite's needs so adding a spec never reopens this.
      AUTH_RATE_LIMIT_SIGNUP: '1000',
      AUTH_RATE_LIMIT_LOGIN: '1000',
      AUTH_RATE_LIMIT_FORGOT: '1000',
      AUTH_RATE_LIMIT_RESEND_VERIFY: '1000',
      AUTH_RATE_LIMIT_RESET_PASSWORD: '1000'
    }
  }
});
