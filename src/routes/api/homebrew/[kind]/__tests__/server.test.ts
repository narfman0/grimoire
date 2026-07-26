// Tests for POST /api/homebrew/[kind] — single-row create. Specifically
// covers the optional `packSlug` body field and the ownership gate.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';

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

async function seedOwnedPack(db: Db, ownerUserId: string, slug: string): Promise<void> {
  const now = new Date();
  await db.insert(schema.packs).values({
    slug,
    name: slug,
    version: '1.0',
    defaultSource: slug,
    loadedAt: now,
    ownerUserId,
    visibility: 'private',
    createdAt: now
  });
}

describe('POST /api/homebrew/[kind]', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('default path: no packSlug body field → row lands in fast-path bucket', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { kind: 'feature' },
        body: { slug: 'foo', name: 'Foo', data: {} }
      })
    );
    const body = await res.json();
    expect(body.slug).toBe('foo');
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, 'foo'))
      .limit(1);
    expect(row.packSlug).toBe('homebrew');
    expect(row.source).toBe('homebrew');
  });

  it('explicit packSlug → row lands in that pack and stamps source = packSlug', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await seedOwnedPack(db, userId, 'alice-pack');

    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { kind: 'feature' },
        body: { slug: 'foo', name: 'Foo', data: {}, packSlug: 'alice-pack' }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, 'foo'))
      .limit(1);
    expect(row.packSlug).toBe('alice-pack');
    expect(row.source).toBe('alice-pack');
  });

  it('explicit packSlug pointing at another user\'s pack → 403', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedOwnedPack(db, aliceId, 'alice-pack');
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(bobId, 'bob'),
          params: { kind: 'feature' },
          body: { slug: 'sneaky', name: 'Sneaky', data: {}, packSlug: 'alice-pack' }
        })
      ),
      403
    );
  });

  it('explicit packSlug pointing at a non-existent pack → 404', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { kind: 'feature' },
          body: { slug: 'foo', name: 'Foo', data: {}, packSlug: 'no-such-pack' }
        })
      ),
      404
    );
  });
});

// kind='feat' used to have a bespoke route (/api/homebrew/feats); it now goes
// through the generic handler. These tests are ported from that route's suite
// and lock the same behavior against the generic surface.
describe('POST /api/homebrew/[kind] with kind=feat (legacy feats route parity)', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('default path: row lands in fast-path bucket', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { kind: 'feat' },
        body: { slug: 'mighty', name: 'Mighty', data: {} }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, 'mighty'))
      .limit(1);
    expect(row.kind).toBe('feat');
    expect(row.packSlug).toBe('homebrew');
  });

  it('explicit packSlug → row lands in that owned pack', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await seedOwnedPack(db, userId, 'alice-feats');
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { kind: 'feat' },
        body: { slug: 'mighty', name: 'Mighty', data: {}, packSlug: 'alice-feats' }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, 'mighty'))
      .limit(1);
    expect(row.packSlug).toBe('alice-feats');
    expect(row.source).toBe('alice-feats');
  });

  it("explicit packSlug pointing at another user's pack → 403", async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedOwnedPack(db, aliceId, 'alice-feats');
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(bobId, 'bob'),
          params: { kind: 'feat' },
          body: { slug: 'mighty', name: 'Mighty', data: {}, packSlug: 'alice-feats' }
        })
      ),
      403
    );
  });
});
