// Tests for the process-level pack-content cache behind buildContentLookup
// (src/lib/server/content/cache.ts). Covers:
//  (a) two lookups for the same owner reuse the cached pack map (one DB
//      scan, one JSON.parse pass) — observable via contentCacheStats(),
//  (b) content mutations through the homebrew import / visibility routes
//      bump the generation so the next lookup rebuilds,
//  (c) transparency — cached and uncached calls resolve identical maps.

import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent } from '$lib/server/__tests__/test-event';
import { buildContentLookup } from '../lookup';
import { contentCacheStats, invalidateContentCache, resetContentCache } from '../cache';
import { contentMapKey } from '$lib/rules/types';
import { POST as importPost } from '../../../../routes/api/homebrew/import/+server';
import { PUT as visibilityPut } from '../../../../routes/api/homebrew/[kind]/[slug]/visibility/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username = 'user') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Synthetic 'homebrew' pack row (drizzle/0009) — content.pack_slug FK. */
async function seedHomebrewPack(db: Db): Promise<void> {
  const now = new Date();
  await db.insert(schema.packs).values({
    slug: 'homebrew',
    name: 'Homebrew',
    version: '1',
    defaultSource: 'homebrew',
    loadedAt: now,
    visibility: 'private',
    createdAt: now
  });
}

/** A minimal global pack row (owner_user_id NULL) — the cached half. */
async function seedPackRow(db: Db, slug: string, data: Record<string, unknown> = {}): Promise<void> {
  const now = new Date();
  await db.insert(schema.content).values({
    id: crypto.randomUUID(),
    kind: 'feature',
    slug,
    version: 1,
    source: 'homebrew',
    scopeId: null,
    ownerUserId: null,
    packSlug: 'homebrew',
    name: slug,
    data: JSON.stringify(data),
    visibility: 'unlisted',
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  });
}

describe('buildContentLookup pack cache', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('second call for the same owner hits the cache instead of re-scanning pack rows', async () => {
    await seedPackRow(db, 'pack-feature-a', { features: [{ id: 'f1' }] });
    await seedPackRow(db, 'pack-feature-b');
    resetContentCache();

    const first = await buildContentLookup();
    const afterFirst = contentCacheStats();
    expect(afterFirst.misses).toBe(1);
    expect(afterFirst.hits).toBe(0);
    expect(afterFirst.cached).toBe(true);

    const second = await buildContentLookup();
    const afterSecond = contentCacheStats();
    expect(afterSecond.misses).toBe(1);
    expect(afterSecond.hits).toBe(1);

    // Transparent: identical resolution either way.
    expect(second.size).toBe(first.size);
    expect(second.map).toEqual(first.map);
    const key = contentMapKey('feature', 'pack-feature-a', null);
    expect(second.map[key]).toBeDefined();
    expect(second.lookup({ kind: 'feature', slug: 'pack-feature-a' })?.name).toBe(
      'pack-feature-a'
    );
  });

  it('cache is shared across distinct owners; per-user rows stay fresh', async () => {
    await seedPackRow(db, 'shared-pack-row');
    const aliceId = await seedUser(db, { username: 'alice' });
    resetContentCache();

    await buildContentLookup(); // warm (anonymous)
    const { map } = await buildContentLookup(aliceId); // different owner, same pack map
    expect(contentCacheStats().hits).toBe(1);
    expect(map[contentMapKey('feature', 'shared-pack-row', null)]).toBeDefined();

    // A fresh owned row shows up without any invalidation — the per-user
    // half is never cached.
    const now = new Date();
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'feature',
      slug: 'alice-own',
      version: 1,
      source: 'homebrew',
      scopeId: null,
      ownerUserId: aliceId,
      packSlug: 'homebrew',
      name: 'Alice Own',
      data: '{}',
      visibility: 'private',
      createdAt: now,
      updatedAt: now
    });
    const again = await buildContentLookup(aliceId);
    expect(again.map[contentMapKey('feature', 'alice-own', aliceId)]).toBeDefined();
  });

  it('returned map is a fresh object per call — mutating it cannot poison the cache', async () => {
    await seedPackRow(db, 'immutable-row');
    resetContentCache();

    const first = await buildContentLookup();
    delete first.map[contentMapKey('feature', 'immutable-row', null)];

    const second = await buildContentLookup();
    expect(second.map[contentMapKey('feature', 'immutable-row', null)]).toBeDefined();
  });

  it('homebrew import invalidates the cache', async () => {
    await seedPackRow(db, 'pre-import-row');
    resetContentCache();
    await buildContentLookup(); // warm
    expect(contentCacheStats().cached).toBe(true);
    const genBefore = contentCacheStats().generation;

    const userId = await seedUser(db, { username: 'alice' });
    const res = await importPost(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: { slug: 'my-pack', name: 'My Pack', version: '1.0', default_source: 'my-pack' },
          rows: [{ kind: 'feature', slug: 'imported', version: 1, name: 'Imported', data: {} }]
        }
      })
    );
    expect(res.status).toBe(200);

    const after = contentCacheStats();
    expect(after.generation).toBeGreaterThan(genBefore);
    expect(after.cached).toBe(false);

    // Next lookup is a rebuild, not a stale hit.
    const hitsBefore = after.hits;
    await buildContentLookup();
    const rebuilt = contentCacheStats();
    expect(rebuilt.hits).toBe(hitsBefore);
    expect(rebuilt.misses).toBeGreaterThanOrEqual(2);
  });

  it('homebrew visibility change invalidates the cache', async () => {
    resetContentCache();
    const userId = await seedUser(db, { username: 'alice' });
    const now = new Date();
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'feature',
      slug: 'toggle-me',
      version: 1,
      source: 'homebrew',
      scopeId: null,
      ownerUserId: userId,
      packSlug: 'homebrew',
      name: 'Toggle Me',
      data: '{}',
      visibility: 'private',
      publishedAt: null,
      createdAt: now,
      updatedAt: now
    });

    await buildContentLookup(userId); // warm the pack half
    expect(contentCacheStats().cached).toBe(true);
    const genBefore = contentCacheStats().generation;

    const res = await visibilityPut(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { kind: 'feature', slug: 'toggle-me' },
        body: { visibility: 'public' },
        method: 'PUT'
      })
    );
    expect(res.status).toBe(200);

    const after = contentCacheStats();
    expect(after.generation).toBeGreaterThan(genBefore);
    expect(after.cached).toBe(false);
  });

  it('invalidateContentCache() bumps the generation and drops the cached map', async () => {
    await seedPackRow(db, 'row-x');
    resetContentCache();
    await buildContentLookup();
    const before = contentCacheStats();
    expect(before.cached).toBe(true);

    invalidateContentCache();
    const after = contentCacheStats();
    expect(after.generation).toBe(before.generation + 1);
    expect(after.cached).toBe(false);
  });
});
