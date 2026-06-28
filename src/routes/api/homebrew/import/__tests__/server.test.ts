// Tests for POST /api/homebrew/import — the per-user bulk-import endpoint.
// Mirrors the admin import-content tests but exercises the unauthenticated
// path (must 401), the bulk-row cap (413), and per-row error semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';
import { HOMEBREW_IMPORT_MAX_ROWS } from '$lib/server/content/schemas';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username = 'user') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Seed the synthetic 'homebrew' pack row that drizzle/0009 inserts in
 *  production. content.pack_slug → packs.slug is a FK, so any homebrew
 *  insert needs this row to exist. */
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

const baseMeta = {
  slug: 'my-pack',
  name: 'My Pack',
  version: '1.0',
  default_source: 'my-pack'
};

describe('POST /api/homebrew/import', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('inserts a mixed-kind batch as owned homebrew (visibility=unlisted, real pack)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'foo', version: 1, name: 'Foo', data: {} },
            { kind: 'spell', slug: 'bar', version: 1, name: 'Bar', data: { level: 2 } },
            { kind: 'item', slug: 'baz', version: 1, name: 'Baz', data: { rarity: 'rare' } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ created: 3, updated: 0, skipped: 0, errors: [] });

    const rows = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, userId));
    expect(rows).toHaveLength(3);
    // meta.slug = 'my-pack' (not 'homebrew') so a real packs row is created
    // and every content row points at it.
    for (const r of rows) {
      expect(r.ownerUserId).toBe(userId);
      expect(r.packSlug).toBe('my-pack');
      expect(r.source).toBe('my-pack');
      expect(r.visibility).toBe('unlisted');
    }

    const [pack] = await db
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, 'my-pack'))
      .limit(1);
    expect(pack).toBeDefined();
    expect(pack.ownerUserId).toBe(userId);
    expect(pack.visibility).toBe('private');
  });

  it("meta.slug === 'homebrew' lands rows in the fast-path bucket (no new packs row)", async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: { slug: 'homebrew', name: 'Homebrew', version: '1', default_source: 'homebrew' },
          rows: [{ kind: 'feature', slug: 'foo', version: 1, name: 'Foo', data: {} }]
        }
      })
    );
    expect((await res.json()).created).toBe(1);

    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, userId))
      .limit(1);
    expect(row.packSlug).toBe('homebrew');

    // No new packs row beyond the synthetic 'homebrew' bucket already seeded.
    const allPacks = await db.select().from(schema.packs);
    expect(allPacks).toHaveLength(1);
  });

  it('refuses to clobber another user\'s pack of the same slug (409)', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: {
          meta: { ...baseMeta, slug: 'contested' },
          rows: [{ kind: 'feature', slug: 'a', version: 1, name: 'A', data: {} }]
        }
      })
    );
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(bobId, 'bob'),
          body: {
            meta: { ...baseMeta, slug: 'contested' },
            rows: [{ kind: 'feature', slug: 'a', version: 1, name: 'A', data: {} }]
          }
        })
      ),
      409
    );
  });

  it('re-importing the same slugs updates in place (no duplicates)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const event1 = () =>
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'foo', version: 1, name: 'Foo', data: {} },
            { kind: 'feature', slug: 'bar', version: 1, name: 'Bar', data: {} },
            { kind: 'feature', slug: 'baz', version: 1, name: 'Baz', data: {} }
          ]
        }
      });
    await POST(event1());

    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'foo', version: 1, name: 'Foo (renamed)', data: {} },
            { kind: 'feature', slug: 'bar', version: 1, name: 'Bar (renamed)', data: {} },
            { kind: 'feature', slug: 'baz', version: 1, name: 'Baz (renamed)', data: {} }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ created: 0, updated: 3, skipped: 0, errors: [] });

    const rows = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, userId));
    expect(rows).toHaveLength(3);
    const fooRow = rows.find((r) => r.slug === 'foo')!;
    expect(fooRow.name).toBe('Foo (renamed)');
  });

  it('per-row data-shape failures land in errors[] without aborting siblings', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'spell', slug: 'good', version: 1, name: 'Good', data: { level: 2 } },
            // Use an actually-invalid feat row (choices.asi has a bad ability) — rejected.
            { kind: 'feat', slug: 'bad', version: 1, name: 'Bad', data: { choices: { asi: { allowedAbilities: ['nope'] } } } },
            { kind: 'spell', slug: 'also-good', version: 1, name: 'Also', data: {} }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.created).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ slug: 'bad', kind: 'feat' });
  });

  it('returns 401 when not logged in', async () => {
    await expectHttpError(
      POST(
        makeEvent({
          user: null,
          body: {
            meta: baseMeta,
            rows: [{ kind: 'feature', slug: 'x', version: 1, name: 'X', data: {} }]
          }
        })
      ),
      401
    );
  });

  it('returns 413 above the bulk row cap', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    // Build HOMEBREW_IMPORT_MAX_ROWS+1 rows to trip the explicit 413 path.
    const rows = Array.from({ length: HOMEBREW_IMPORT_MAX_ROWS + 1 }, (_, i) => ({
      kind: 'feature' as const,
      slug: `s-${i}`,
      version: 1,
      name: `Row ${i}`,
      data: {}
    }));
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(userId, 'alice'),
          body: { meta: baseMeta, rows }
        })
      ),
      413
    );
  });

  it('upsert is scoped to the caller via the fast-path bucket (cross-user coexistence)', async () => {
    // Two users importing into the synthetic 'homebrew' bucket with the
    // same slug both succeed — content.owner_user_id distinguishes them.
    // Real packs (meta.slug !== 'homebrew') are owner-locked instead — see
    // the 409 test above.
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    const fastPathMeta = {
      slug: 'homebrew',
      name: 'Homebrew',
      version: '1',
      default_source: 'homebrew'
    };

    await POST(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: {
          meta: fastPathMeta,
          rows: [{ kind: 'feature', slug: 'shared', version: 1, name: 'Alice', data: {} }]
        }
      })
    );
    await POST(
      makeEvent({
        user: userOf(bobId, 'bob'),
        body: {
          meta: fastPathMeta,
          rows: [{ kind: 'feature', slug: 'shared', version: 1, name: 'Bob', data: {} }]
        }
      })
    );

    const all = await db
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.kind, 'feature'), eq(schema.content.slug, 'shared')));
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.ownerUserId).sort()).toEqual([aliceId, bobId].sort());
  });

  it("row's own source overrides meta.default_source", async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'a', version: 1, name: 'A', data: {} },
            { kind: 'feature', slug: 'b', version: 1, source: 'custom-source', name: 'B', data: {} }
          ]
        }
      })
    );
    const rows = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, userId));
    const sourceBySlug = Object.fromEntries(rows.map((r) => [r.slug, r.source]));
    expect(sourceBySlug).toEqual({ a: 'my-pack', b: 'custom-source' });
  });
});
