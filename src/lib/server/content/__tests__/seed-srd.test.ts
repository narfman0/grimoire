// Tests for seedSrdIfMissing(): the boot-time seed for the in-repo SRD
// content pack. First call walks ./content-packs/ and inserts; second
// call observes the packs row already exists and short-circuits. The
// old GRIMOIRE_PACKS_DIR walk is gone — non-SRD content flows through
// /api/homebrew/import now.

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { isSkeletonData, seedSrdIfMissing } from '../loader';

type Db = ReturnType<typeof setupTestDb>;

describe('seedSrdIfMissing', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('first call seeds the SRD pack from ./content-packs', async () => {
    const result = await seedSrdIfMissing();
    expect(result.skipped).toBe(false);
    expect(result.loaded).toBeGreaterThan(0);

    const packs = await db.select().from(schema.packs);
    const slugs = packs.map((p) => p.slug);
    expect(slugs).toContain('srd-5.2');

    const contentRows = await db.select({ id: schema.content.id }).from(schema.content);
    expect(contentRows.length).toBe(result.loaded);
  });

  it('second call re-seeds idempotently (upserts, never skips)', async () => {
    const first = await seedSrdIfMissing();
    expect(first.skipped).toBe(false);

    const second = await seedSrdIfMissing();
    expect(second.skipped).toBe(false);
    expect(second.loaded).toBe(first.loaded);
  });

  it('does not walk grimoire-packs / any external dir (no env override)', async () => {
    // Snapshot what packs the seed produces. Should be ONLY in-repo packs
    // (srd-5.2). Any pack with a slug outside the in-repo set would be a
    // regression to the old GRIMOIRE_PACKS_DIR behavior.
    await seedSrdIfMissing();
    const packs = await db.select({ slug: schema.packs.slug }).from(schema.packs);
    const slugs = new Set(packs.map((p) => p.slug));
    // The only on-disk pack right now is srd-5.2. If the repo gains
    // additional SRD packs (e.g. srd-5.1) update this assertion.
    expect([...slugs].every((s) => s.startsWith('srd-'))).toBe(true);
  });

  // Regression: the skeleton-shadow guard counted only activities /
  // features / modifiers / triggers. Weapon Mastery's new row carries just a
  // `choices` slot, so a reseed kept the stale row (with its placeholder
  // trait) forever — the fix would never have reached prod.
  it('replaces an older row with a choices-only row on reseed', async () => {
    await seedSrdIfMissing();
    const where = and(
      eq(schema.content.kind, 'feature'),
      eq(schema.content.slug, 'weapon-mastery'),
      isNull(schema.content.ownerUserId)
    );
    const stale = {
      modifiers: [
        { kind: 'stat-modifier', target: 'trait.weapon-mastery-chosen', mode: 'OVERRIDE', value: true }
      ]
    };
    await db.update(schema.content).set({ data: JSON.stringify(stale) }).where(where);

    await seedSrdIfMissing();
    const [row] = await db.select({ data: schema.content.data }).from(schema.content).where(where);
    expect(JSON.parse(row.data as string).choices?.weaponMasteries).toBeDefined();
  });

  it('isSkeletonData treats choices and activations as rules content', () => {
    expect(isSkeletonData({ description: 'flavor only' })).toBe(true);
    expect(isSkeletonData({ choices: {} })).toBe(true);
    expect(isSkeletonData({ choices: { weaponMasteries: { picks: 2 } } })).toBe(false);
    expect(isSkeletonData({ activations: [{ id: 'rage' }] })).toBe(false);
  });
});
