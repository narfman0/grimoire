// Tests for seedSrdIfMissing(): the boot-time seed for the in-repo SRD
// content pack. First call walks ./content-packs/ and inserts; second
// call observes the packs row already exists and short-circuits. The
// old GRIMOIRE_PACKS_DIR walk is gone — non-SRD content flows through
// /api/homebrew/import now.

import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedSrdIfMissing } from '../loader';

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

  it('second call short-circuits when SRD pack is already present', async () => {
    const first = await seedSrdIfMissing();
    expect(first.skipped).toBe(false);

    const second = await seedSrdIfMissing();
    expect(second).toEqual({ loaded: 0, skipped: true });
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
});
