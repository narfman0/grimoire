import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const adminOf = (id: string) => ({ id, username: 'admin', isAdmin: true, email: null, emailVerified: false });
const userOf = (id: string) => ({ id, username: 'user', isAdmin: false, email: null, emailVerified: false });

/** Seeds the synthetic 'homebrew' pack row that drizzle/0009 inserts in
 *  production. content.pack_slug → packs.slug is a FK, so any homebrew
 *  insert needs this row to exist. */
async function seedHomebrewPack(db: Db): Promise<void> {
  await db.insert(schema.packs).values({
    slug: 'homebrew',
    name: 'Homebrew',
    version: '1',
    defaultSource: 'homebrew',
    loadedAt: new Date()
  });
}

describe('POST /api/admin/import-content', () => {
  let db: Db;
  beforeEach(async () => {
    db = setupTestDb();
    await seedHomebrewPack(db);
  });

  it('inserts each row as homebrew owned by the caller', async () => {
    const adminId = await seedUser(db, { username: 'admin', isAdmin: true });
    const res = await POST(
      makeEvent({
        user: adminOf(adminId),
        body: {
          rows: [
            { kind: 'spell', slug: 'air-bubble', name: 'Air Bubble', data: { level: 2, components: ['s'] } },
            { kind: 'item', slug: 'fish-suit', name: 'Fish Suit', data: { weight: null, rarity: 'very rare' } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ inserted: 2, updated: 0, skipped: 0, failed: [] });

    const rows = await db.select().from(schema.content);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.source).toBe('homebrew');
      expect(r.packSlug).toBe('homebrew');
      expect(r.ownerUserId).toBe(adminId);
      expect(r.visibility).toBe('private');
    }
  });

  // The motivation for this endpoint: pack data shapes (e.g. spell components
  // as an array, item weight=null) that the per-kind /api/homebrew/[kind]
  // endpoints reject via strict schemas must succeed here.
  it('accepts pack-shaped data that strict homebrew schemas would reject', async () => {
    const adminId = await seedUser(db, { username: 'admin', isAdmin: true });
    const res = await POST(
      makeEvent({
        user: adminOf(adminId),
        body: {
          rows: [
            { kind: 'feat', slug: 'bomber', name: 'Bomber', data: { triggers: [{ on: 'attack' }] } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.failed).toEqual([]);
  });

  it('mode=skip (default) counts dupes without overwriting', async () => {
    const adminId = await seedUser(db, { username: 'admin', isAdmin: true });
    const row = { kind: 'spell', slug: 'fireball', name: 'Fireball', data: { level: 3 } };
    await POST(makeEvent({ user: adminOf(adminId), body: { rows: [row] } }));
    const res = await POST(
      makeEvent({
        user: adminOf(adminId),
        body: { rows: [{ ...row, name: 'Fireball (renamed)' }] }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ inserted: 0, updated: 0, skipped: 1, failed: [] });

    const [row1] = await db
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.kind, 'spell'), eq(schema.content.slug, 'fireball')));
    expect(row1.name).toBe('Fireball'); // unchanged
  });

  it('mode=replace overwrites existing rows in place', async () => {
    const adminId = await seedUser(db, { username: 'admin', isAdmin: true });
    const row = { kind: 'spell', slug: 'fireball', name: 'Fireball', data: { level: 3 } };
    await POST(makeEvent({ user: adminOf(adminId), body: { rows: [row] } }));
    const res = await POST(
      makeEvent({
        user: adminOf(adminId),
        body: {
          mode: 'replace',
          rows: [{ ...row, name: 'Fireball (corrected)', data: { level: 3, damageDice: '8d6' } }]
        }
      })
    );
    const body = await res.json();
    expect(body).toEqual({ inserted: 0, updated: 1, skipped: 0, failed: [] });

    const [row1] = await db
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.kind, 'spell'), eq(schema.content.slug, 'fireball')));
    expect(row1.name).toBe('Fireball (corrected)');
    expect(JSON.parse(row1.data as string)).toEqual({ level: 3, damageDice: '8d6' });
  });

  // Pack-loaded rows have ownerUserId=null (or the pack author's id);
  // importing the same slug under a different owner would 409 on the
  // unique index. Surface as a per-row failure with a clear message
  // instead of aborting the whole batch.
  it('reports a per-row failure when another user already owns the slug', async () => {
    const adminId = await seedUser(db, { username: 'admin', isAdmin: true });
    const otherId = await seedUser(db, { username: 'other' });
    // Pre-seed a row owned by 'other'.
    await db.insert(schema.content).values({
      id: crypto.randomUUID(),
      kind: 'spell',
      slug: 'fireball',
      version: 1,
      source: 'homebrew',
      scopeId: null,
      ownerUserId: otherId,
      packSlug: 'homebrew',
      name: 'Fireball (by other)',
      data: '{}',
      visibility: 'private',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const res = await POST(
      makeEvent({
        user: adminOf(adminId),
        body: { rows: [{ kind: 'spell', slug: 'fireball', name: 'Fireball', data: {} }] }
      })
    );
    const body = await res.json();
    expect(body.inserted).toBe(0);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]).toMatchObject({ kind: 'spell', slug: 'fireball' });
    expect(body.failed[0].error).toMatch(/already owned by another user/);
  });

  it('rejects non-admins with 403', async () => {
    const userId = await seedUser(db, { username: 'user' });
    await expectHttpError(
      POST(
        makeEvent({
          user: userOf(userId),
          body: { rows: [{ kind: 'spell', slug: 's', name: 's', data: {} }] }
        })
      ),
      403
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    await expectHttpError(
      POST(
        makeEvent({
          user: null,
          body: { rows: [{ kind: 'spell', slug: 's', name: 's', data: {} }] }
        })
      ),
      401
    );
  });
});
