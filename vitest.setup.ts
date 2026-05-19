// Force the in-memory SQLite path BEFORE anything imports $lib/server/db,
// so the singleton in src/lib/server/db/index.ts attaches to a throwaway
// database. Each Vitest worker forks → each gets its own in-memory db,
// and migrations run lazily via setupTestDb() in any test that needs it.
process.env.DATABASE_URL = ':memory:';

import { afterEach, vi } from 'vitest';
import { readable } from 'svelte/store';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';

// Auto-unmount Svelte components between tests so the previous render's
// DOM doesn't leak into the next test (causing "found multiple elements"
// errors from @testing-library queries).
afterEach(() => cleanup());

// SvelteKit's $app/* and $env/* modules don't exist at test time — stub the
// shapes that component code touches at module evaluation. Add to these as
// new components import new $app/* surfaces.

vi.mock('$app/stores', () => ({
  page: readable({
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
    status: 200,
    error: null,
    data: {},
    form: undefined
  }),
  navigating: readable(null),
  updated: readable(false)
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn()
}));

vi.mock('$app/environment', () => ({
  browser: true,
  building: false,
  dev: true,
  version: 'test'
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/static/public', () => ({}));
vi.mock('$env/static/private', () => ({}));
