// Tests for POST /api/homebrew/[kind]/fork — clone someone else's row.
// Specifically covers the optional `packSlug` body field; the rest of the
// fork semantics (default new-slug prefix, source not-found, etc.) are
// covered by the broader test surface.

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

async function seedShareableRow(
  db: Db,
  ownerUserId: string,
  slug: string,
  kind = 'feature'
): Promise<void> {
  const now = new Date();
  await db.insert(schema.content).values({
    id: crypto.randomUUID(),
    kind,
    slug,
    version: 1,
    source: 'homebrew',
    scopeId: null,
    ownerUserId,
    packSlug: 'homebrew',
    name: slug,
    data: '{}',
    createdAt: now,
    updatedAt: now,
    visibility: 'unlisted'
  });
}

describe('POST /api/homebrew/[kind]/fork', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('default path: forked row lands in the fast-path bucket', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedShareableRow(db, aliceId, 'fireball-plus');

    const res = await POST(
      makeEvent({
        user: userOf(bobId, 'bob'),
        params: { kind: 'feature' },
        body: { slug: 'fireball-plus', authorUserId: aliceId }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, bobId))
      .limit(1);
    expect(row.packSlug).toBe('homebrew');
  });

  it('explicit packSlug → fork lands in that owned pack', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedShareableRow(db, aliceId, 'fireball-plus');
    await seedOwnedPack(db, bobId, 'bob-pack');

    const res = await POST(
      makeEvent({
        user: userOf(bobId, 'bob'),
        params: { kind: 'feature' },
        body: { slug: 'fireball-plus', authorUserId: aliceId, packSlug: 'bob-pack' }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.ownerUserId, bobId))
      .limit(1);
    expect(row.packSlug).toBe('bob-pack');
  });

  it('explicit packSlug pointing at another user\'s pack → 403', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedShareableRow(db, aliceId, 'fireball-plus');
    await seedOwnedPack(db, aliceId, 'alice-pack');

    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(bobId, 'bob'),
          params: { kind: 'feature' },
          body: { slug: 'fireball-plus', authorUserId: aliceId, packSlug: 'alice-pack' }
        })
      ),
      403
    );
  });
});
