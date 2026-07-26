// Process-level cache for the immutable half of buildContentLookup: the
// parsed global pack rows (`content.owner_user_id IS NULL`). These only
// change at boot seeding, pack import/patch/delete, or admin content
// import — so re-scanning and re-JSON.parsing the whole ~740K SRD corpus
// on every lookup (which happens per character on encounter pages) is
// pure waste.
//
// Design: a single monotonically-increasing generation number. Any
// mutation of the `content` (or `packs`) tables calls
// `invalidateContentCache()`, which bumps the generation and drops the
// cached map. This is deliberately coarse — a per-user homebrew edit also
// flushes the pack cache — because correctness beats cleverness here and
// content mutations happen at human pace.
//
// Per-user rows (owned / subscribed / campaign-granted homebrew) are NOT
// cached; buildContentLookup queries those fresh on every call.
//
// Tests: the vitest workers truncate every table between tests
// (src/lib/server/__tests__/test-db.ts), which raw-DELETEs `content`
// without going through any route. setupTestDb() calls
// `resetContentCache()` so no stale pack map leaks across tests.

import type { ContentRow } from '$lib/rules/types';

let generation = 1;
let cached: { generation: number; map: Record<string, ContentRow> } | null = null;
let hits = 0;
let misses = 0;

/** Current generation. Capture BEFORE querying the DB and pass it to
 *  `setCachedPackMap` so an invalidation that lands mid-query wins over
 *  the (now potentially stale) query result. */
export function contentCacheGeneration(): number {
  return generation;
}

/** Bump the generation and drop the cached pack map. Call from every code
 *  path that mutates the `content` or `packs` tables. */
export function invalidateContentCache(): void {
  generation += 1;
  cached = null;
}

/** Full reset for tests: invalidate + zero the hit/miss counters. Wired
 *  into setupTestDb() so per-test table truncation can't leak a stale
 *  pack map into the next test. */
export function resetContentCache(): void {
  invalidateContentCache();
  hits = 0;
  misses = 0;
}

/** The cached parsed pack map, or null when absent/stale. Updates
 *  hit/miss stats as a side effect. */
export function getCachedPackMap(): Record<string, ContentRow> | null {
  if (cached && cached.generation === generation) {
    hits += 1;
    return cached.map;
  }
  misses += 1;
  return null;
}

/** Store a freshly-built pack map. `generationAtRead` must be the value
 *  of `contentCacheGeneration()` captured before the DB query that
 *  produced `map`; if an invalidation happened in between, the store is
 *  silently skipped so the next lookup rebuilds. */
export function setCachedPackMap(
  map: Record<string, ContentRow>,
  generationAtRead: number
): void {
  if (generationAtRead !== generation) return;
  cached = { generation, map };
}

/** Observability hook for tests and debugging. */
export function contentCacheStats(): {
  hits: number;
  misses: number;
  generation: number;
  cached: boolean;
} {
  return { hits, misses, generation, cached: cached !== null };
}
