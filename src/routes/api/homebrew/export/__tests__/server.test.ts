// Tests for GET /api/homebrew/export. The contract is: same JSON shape as
// POST /api/homebrew/import accepts, so an export → import roundtrip
// (same user) is a no-op. Tests cover the empty case, full roundtrip,
// kind/source filtering, and the 401 path.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';
import { POST as importPost } from '../../import/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username = 'user') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

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

describe('GET /api/homebrew/export', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('returns {meta:null, rows:[]} when the user has no homebrew', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await GET(makeEvent({ user: userOf(userId, 'alice') }));
    const body = await res.json();
    expect(body).toEqual({ meta: null, rows: [] });
  });

  it('roundtrips: import → export → re-import yields the same rows', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const importPayload = {
      meta: baseMeta,
      rows: [
        { kind: 'feature', slug: 'foo', version: 1, name: 'Foo', data: { tag: 'x' } },
        { kind: 'spell', slug: 'bar', version: 1, name: 'Bar', data: { level: 2 } }
      ]
    };
    await importPost(
      makeEvent({ user: userOf(userId, 'alice'), body: importPayload })
    );

    const exportRes = await GET(makeEvent({ user: userOf(userId, 'alice') }));
    const exported = await exportRes.json();
    expect(exported.meta).not.toBeNull();
    expect(exported.rows).toHaveLength(2);

    // Feed the export back into import — same user — should produce 2 updated.
    const reimportRes = await importPost(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { meta: exported.meta, rows: exported.rows }
      })
    );
    const reimportBody = await reimportRes.json();
    expect(reimportBody).toEqual({ created: 0, updated: 2, skipped: 0, errors: [] });

    // Row count unchanged.
    const rows = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, userId));
    expect(rows).toHaveLength(2);
  });

  it('filters by kind', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await importPost(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'f1', version: 1, name: 'F1', data: {} },
            { kind: 'spell', slug: 's1', version: 1, name: 'S1', data: {} }
          ]
        }
      })
    );
    const res = await GET(
      makeEvent({ user: userOf(userId, 'alice'), searchParams: { kind: 'spell' } })
    );
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].kind).toBe('spell');
  });

  it('filters by source', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await importPost(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: {
          meta: baseMeta,
          rows: [
            { kind: 'feature', slug: 'a', version: 1, name: 'A', data: {} },
            { kind: 'feature', slug: 'b', version: 1, source: 'other', name: 'B', data: {} }
          ]
        }
      })
    );
    const res = await GET(
      makeEvent({ user: userOf(userId, 'alice'), searchParams: { source: 'other' } })
    );
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].slug).toBe('b');
  });

  it('returns 401 when not logged in', async () => {
    await expectHttpError(GET(makeEvent({ user: null })), 401);
  });

  it('only includes the calling user’s rows (no cross-user leakage)', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    // Real packs are owner-scoped now, so each user gets their own pack
    // slug. Cross-user collision on real-pack slugs is a 409 (covered in
    // the import tests); here we just want disjoint rows.
    await importPost(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: {
          meta: { ...baseMeta, slug: 'alice-pack', default_source: 'alice-pack' },
          rows: [{ kind: 'feature', slug: 'a', version: 1, name: 'Alice', data: {} }]
        }
      })
    );
    await importPost(
      makeEvent({
        user: userOf(bobId, 'bob'),
        body: {
          meta: { ...baseMeta, slug: 'bob-pack', default_source: 'bob-pack' },
          rows: [{ kind: 'feature', slug: 'b', version: 1, name: 'Bob', data: {} }]
        }
      })
    );
    const res = await GET(makeEvent({ user: userOf(aliceId, 'alice') }));
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].name).toBe('Alice');
  });
});
