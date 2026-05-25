// Tests for the /api/packs collection endpoints (POST/GET) and the
// /api/packs/[slug] single-pack endpoints (GET/PATCH/DELETE).

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST as POST_COLLECTION, GET as GET_COLLECTION } from '../+server';
import { GET as GET_DETAIL, PATCH as PATCH_DETAIL, DELETE as DELETE_DETAIL } from '../[slug]/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username = 'user') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Seed the system 'homebrew' bucket so collision-with-system tests can
 *  reach for a known-reserved slug. */
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

/** Seed a stand-in srd-5.2 pack so visibility tests have a public anchor. */
async function seedSrdPack(db: Db): Promise<void> {
  const now = new Date();
  await db.insert(schema.packs).values({
    slug: 'srd-5.2',
    name: 'SRD 5.2',
    version: '1',
    defaultSource: 'srd-5.2',
    loadedAt: now,
    visibility: 'public',
    createdAt: now
  });
}

describe('POST /api/packs', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
    await seedSrdPack(db);
  });

  it('creates a pack owned by the caller (defaults to private)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    const res = await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'my-cool-pack', name: 'My Cool Pack', version: '1.0' }
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.slug).toBe('my-cool-pack');
    expect(body.ownerUserId).toBe(userId);
    expect(body.visibility).toBe('private');
    expect(body.rowCount).toBe(0);

    const [row] = await db
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, 'my-cool-pack'))
      .limit(1);
    expect(row.ownerUserId).toBe(userId);
  });

  it('rejects collisions with system pack slugs (409)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await expectHttpError(
      POST_COLLECTION(
        makeEvent({
          user: userOf(userId, 'alice'),
          body: { slug: 'homebrew', name: 'New Homebrew', version: '1.0' }
        })
      ),
      409
    );
    await expectHttpError(
      POST_COLLECTION(
        makeEvent({
          user: userOf(userId, 'alice'),
          body: { slug: 'srd-5.1', name: 'Old SRD', version: '1.0' }
        })
      ),
      409
    );
  });

  it('rejects collision with an existing user-owned pack (409)', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'shared-slug', name: "Alice's", version: '1.0' }
      })
    );
    await expectHttpError(
      POST_COLLECTION(
        makeEvent({
          user: userOf(bobId, 'bob'),
          body: { slug: 'shared-slug', name: "Bob's", version: '1.0' }
        })
      ),
      409
    );
  });

  it('requires login', async () => {
    await expectHttpError(
      POST_COLLECTION(
        makeEvent({
          user: null,
          body: { slug: 'p', name: 'P', version: '1.0' }
        })
      ),
      401
    );
  });
});

describe('GET /api/packs', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
    await seedSrdPack(db);
  });

  it('logged-in user sees their own + public packs', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'alice-private', name: "Alice's Private", version: '1.0' }
      })
    );
    await POST_COLLECTION(
      makeEvent({
        user: userOf(bobId, 'bob'),
        body: { slug: 'bob-public', name: "Bob's Public", version: '1.0', visibility: 'public' }
      })
    );
    await POST_COLLECTION(
      makeEvent({
        user: userOf(bobId, 'bob'),
        body: { slug: 'bob-secret', name: "Bob's Secret", version: '1.0' }
      })
    );

    const res = await GET_COLLECTION(makeEvent({ user: userOf(aliceId, 'alice') }));
    const body = await res.json();
    const slugs = (body.items as Array<{ slug: string }>).map((p) => p.slug).sort();
    // Alice sees: her own + public packs + system packs (null-owner).
    expect(slugs).toContain('alice-private');
    expect(slugs).toContain('bob-public');
    expect(slugs).toContain('srd-5.2');
    expect(slugs).toContain('homebrew');
    expect(slugs).not.toContain('bob-secret');
  });

  it('anonymous caller sees only public packs', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'alice-pub', name: 'Pub', version: '1.0', visibility: 'public' }
      })
    );
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'alice-priv', name: 'Priv', version: '1.0' }
      })
    );

    const res = await GET_COLLECTION(makeEvent({ user: null }));
    const body = await res.json();
    const slugs = (body.items as Array<{ slug: string }>).map((p) => p.slug).sort();
    expect(slugs).toContain('alice-pub');
    expect(slugs).toContain('srd-5.2');
    expect(slugs).not.toContain('alice-priv');
    expect(slugs).not.toContain('homebrew'); // private system pack hidden from anon
  });
});

describe('GET /api/packs/[slug]', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
    await seedSrdPack(db);
  });

  it('returns detail with rowCount + per-kind breakdown', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'my-pack', name: 'My Pack', version: '1.0' }
      })
    );

    // Drop a couple of content rows under the pack so the counts mean something.
    const now = new Date();
    for (const [kind, slug] of [
      ['feat', 'foo'],
      ['feat', 'bar'],
      ['spell', 'baz']
    ] as const) {
      await db.insert(schema.content).values({
        id: crypto.randomUUID(),
        kind,
        slug,
        version: 1,
        source: 'my-pack',
        scopeId: null,
        ownerUserId: userId,
        packSlug: 'my-pack',
        name: slug,
        data: '{}',
        createdAt: now,
        updatedAt: now,
        visibility: 'private'
      });
    }

    const res = await GET_DETAIL(
      makeEvent({ user: userOf(userId, 'alice'), params: { slug: 'my-pack' } })
    );
    const body = await res.json();
    expect(body.rowCount).toBe(3);
    expect(body.rowCountByKind).toEqual({ feat: 2, spell: 1 });
  });

  it('404s on a private pack the caller does not own', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'alice-secret', name: 'Secret', version: '1.0' }
      })
    );
    await expectHttpError(
      GET_DETAIL(
        makeEvent({ user: userOf(bobId, 'bob'), params: { slug: 'alice-secret' } })
      ),
      404
    );
  });
});

describe('PATCH /api/packs/[slug]', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
    await seedSrdPack(db);
  });

  it('owner can edit name + description + visibility', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'p', name: 'Original', version: '1.0' }
      })
    );

    const res = await PATCH_DETAIL(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { slug: 'p' },
        body: { name: 'Renamed', description: 'Cool stuff', visibility: 'public' }
      })
    );
    const body = await res.json();
    expect(body.name).toBe('Renamed');
    expect(body.description).toBe('Cool stuff');
    expect(body.visibility).toBe('public');
  });

  it('non-owner gets 403', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'p', name: 'A', version: '1.0' }
      })
    );
    await expectHttpError(
      PATCH_DETAIL(
        makeEvent({
          user: userOf(bobId, 'bob'),
          params: { slug: 'p' },
          body: { name: 'B' }
        })
      ),
      403
    );
  });

  it('rename cascades to content.pack_slug atomically', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'old-slug', name: 'Old', version: '1.0' }
      })
    );

    const now = new Date();
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'feat',
      slug: 'feat-a',
      version: 1,
      source: 'old-slug',
      scopeId: null,
      ownerUserId: userId,
      packSlug: 'old-slug',
      name: 'feat-a',
      data: '{}',
      createdAt: now,
      updatedAt: now,
      visibility: 'private'
    });

    const res = await PATCH_DETAIL(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { slug: 'old-slug' },
        body: { newSlug: 'new-slug' }
      })
    );
    const body = await res.json();
    expect(body.slug).toBe('new-slug');

    const [packOld] = await db
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, 'old-slug'))
      .limit(1);
    expect(packOld).toBeUndefined();

    const rowsUnderNew = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.packSlug, 'new-slug'));
    expect(rowsUnderNew).toHaveLength(1);
    expect(rowsUnderNew[0].slug).toBe('feat-a');

    const rowsUnderOld = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.packSlug, 'old-slug'));
    expect(rowsUnderOld).toHaveLength(0);
  });

  it('rename rejects collision with existing slug (409)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'p-a', name: 'A', version: '1.0' }
      })
    );
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'p-b', name: 'B', version: '1.0' }
      })
    );
    await expectHttpError(
      PATCH_DETAIL(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { slug: 'p-a' },
          body: { newSlug: 'p-b' }
        })
      ),
      409
    );
  });

  it('system packs cannot be edited (403)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await expectHttpError(
      PATCH_DETAIL(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { slug: 'srd-5.2' },
          body: { name: 'Hacked' }
        })
      ),
      403
    );
  });
});

describe('DELETE /api/packs/[slug]', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
    await seedSrdPack(db);
  });

  it('without cascade errors when pack has rows (409)', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'p', name: 'P', version: '1.0' }
      })
    );
    const now = new Date();
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'feat',
      slug: 'a',
      version: 1,
      source: 'p',
      scopeId: null,
      ownerUserId: userId,
      packSlug: 'p',
      name: 'A',
      data: '{}',
      createdAt: now,
      updatedAt: now,
      visibility: 'private'
    });

    await expectHttpError(
      DELETE_DETAIL(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { slug: 'p' }
        })
      ),
      409
    );
  });

  it('with cascade=true wipes rows + pack', async () => {
    const userId = await seedUser(db, { username: 'alice' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(userId, 'alice'),
        body: { slug: 'p', name: 'P', version: '1.0' }
      })
    );
    const now = new Date();
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'feat',
      slug: 'a',
      version: 1,
      source: 'p',
      scopeId: null,
      ownerUserId: userId,
      packSlug: 'p',
      name: 'A',
      data: '{}',
      createdAt: now,
      updatedAt: now,
      visibility: 'private'
    });

    const res = await DELETE_DETAIL(
      makeEvent({
        user: userOf(userId, 'alice'),
        params: { slug: 'p' },
        searchParams: { cascade: 'true' }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ deleted: true, rowsDeleted: 1 });

    const remaining = await db
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, 'p'))
      .limit(1);
    expect(remaining).toHaveLength(0);
  });

  it('refuses to delete system packs (400)', async () => {
    const userId = await seedUser(db, { username: 'alice', isAdmin: true });
    await expectHttpError(
      DELETE_DETAIL(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { slug: 'homebrew' },
          searchParams: { cascade: 'true' }
        })
      ),
      400
    );
    await expectHttpError(
      DELETE_DETAIL(
        makeEvent({
          user: userOf(userId, 'alice'),
          params: { slug: 'srd-5.2' },
          searchParams: { cascade: 'true' }
        })
      ),
      400
    );
  });

  it('non-owner cannot delete (403)', async () => {
    const aliceId = await seedUser(db, { username: 'alice' });
    const bobId = await seedUser(db, { username: 'bob' });
    await POST_COLLECTION(
      makeEvent({
        user: userOf(aliceId, 'alice'),
        body: { slug: 'p', name: 'P', version: '1.0' }
      })
    );
    await expectHttpError(
      DELETE_DETAIL(
        makeEvent({
          user: userOf(bobId, 'bob'),
          params: { slug: 'p' },
          searchParams: { cascade: 'true' }
        })
      ),
      403
    );
  });
});
