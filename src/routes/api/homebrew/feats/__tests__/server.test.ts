// Tests for POST /api/homebrew/feats — feat-specific create. Covers the
// new packSlug body field; the feat-specific data validation is exercised
// separately by the FeatDataSchema unit tests.

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

describe('POST /api/homebrew/feats', () => {
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
        body: { slug: 'mighty', name: 'Mighty', data: {} }
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.slug, 'mighty'))
      .limit(1);
    expect(row.packSlug).toBe('homebrew');
  });

  it('explicit packSlug → row lands in that owned pack', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await seedOwnedPack(db, userId, 'alice-feats');
    const res = await POST(
      makeEvent({
        user: userOf(userId, 'alice'),
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

  it('explicit packSlug pointing at another user\'s pack → 403', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await seedOwnedPack(db, aliceId, 'alice-feats');
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(bobId, 'bob'),
          body: { slug: 'mighty', name: 'Mighty', data: {}, packSlug: 'alice-feats' }
        })
      ),
      403
    );
  });
});
