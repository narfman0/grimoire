import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET as LIST, POST as CREATE } from '../+server';
import { GET, PATCH, DELETE } from '../[id]/+server';
import { POST as CREATE_MAP } from '../../maps/+server';
import { PATCH as PATCH_MAP, DELETE as DELETE_MAP } from '../../maps/[id]/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'owner') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Create a dungeon with two floors (10×8 each) and return ids. */
async function dungeonFixture(db: Db, ownerId: string) {
  const owner = userOf(ownerId);
  const dungeon = await (
    await CREATE(makeEvent({ user: owner, body: { name: 'Barrowmaze' } }))
  ).json();
  const mapIds: string[] = [];
  for (const name of ['Ground', 'Crypts']) {
    const map = await (
      await CREATE_MAP(makeEvent({ user: owner, body: { name, w: 10, h: 8 } }))
    ).json();
    await PATCH_MAP(
      makeEvent({
        user: owner,
        params: { id: map.id },
        body: { dungeonId: dungeon.id },
        method: 'PATCH'
      })
    );
    mapIds.push(map.id);
  }
  return { dungeonId: dungeon.id as string, mapIds };
}

const stairs = (over: Record<string, unknown> = {}) => ({
  id: 'L1',
  kind: 'stairs',
  a: { floorIdx: 0, x: 9, y: 0 },
  b: { floorIdx: 1, x: 0, y: 7 },
  costFt: 5,
  ...over
});

describe('/api/dungeons', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('creates, lists with floor counts, and reads floors in index order', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId } = await dungeonFixture(db, ownerId);

    const list = await (await LIST(makeEvent({ user: userOf(ownerId) }))).json();
    expect(list.dungeons).toHaveLength(1);
    expect(list.dungeons[0].floorCount).toBe(2);

    const full = await (
      await GET(makeEvent({ user: userOf(ownerId), params: { id: dungeonId } }))
    ).json();
    expect(full.floors.map((f: { floorIdx: number; name: string }) => [f.floorIdx, f.name])).toEqual([
      [0, 'Ground'],
      [1, 'Crypts']
    ]);
    expect(full.links).toEqual([]);
  });

  it('stores a valid link set and rejects a broken one with every problem named', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId } = await dungeonFixture(db, ownerId);
    const owner = userOf(ownerId);

    const patched = await (
      await PATCH(
        makeEvent({
          user: owner,
          params: { id: dungeonId },
          body: { links: [stairs()] },
          method: 'PATCH'
        })
      )
    ).json();
    expect(patched.links).toHaveLength(1);

    await expectHttpError(
      PATCH(
        makeEvent({
          user: owner,
          params: { id: dungeonId },
          // Off floor 0 (x: 99) AND on a floor that doesn't exist.
          body: {
            links: [stairs({ a: { floorIdx: 0, x: 99, y: 0 }, b: { floorIdx: 9, x: 0, y: 0 } })]
          },
          method: 'PATCH'
        })
      ),
      400
    );
  });

  it('is owner-only', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const otherId = await seedUser(db, { username: 'other' });
    const { dungeonId } = await dungeonFixture(db, ownerId);
    await expectHttpError(
      GET(makeEvent({ user: userOf(otherId, 'other'), params: { id: dungeonId } })),
      403
    );
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(otherId, 'other'),
          params: { id: dungeonId },
          body: { name: 'Stolen' },
          method: 'PATCH'
        })
      ),
      403
    );
  });

  it('deleting the dungeon reverts member maps to standalone', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId, mapIds } = await dungeonFixture(db, ownerId);
    await DELETE(makeEvent({ user: userOf(ownerId), params: { id: dungeonId }, method: 'DELETE' }));
    const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, mapIds[0]));
    expect(rows[0].dungeonId).toBeNull();
  });

  it('joining assigns the next free floor index; a taken index is a 400', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId, mapIds } = await dungeonFixture(db, ownerId);
    const owner = userOf(ownerId);
    const third = await (
      await CREATE_MAP(makeEvent({ user: owner, body: { name: 'Attic', w: 6, h: 6 } }))
    ).json();
    const joined = await PATCH_MAP(
      makeEvent({
        user: owner,
        params: { id: third.id },
        body: { dungeonId },
        method: 'PATCH'
      })
    );
    expect(joined.status).toBe(200);
    const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, third.id));
    expect(rows[0].floorIdx).toBe(2);

    await expectHttpError(
      PATCH_MAP(
        makeEvent({
          user: owner,
          params: { id: mapIds[1] },
          body: { floorIdx: 0 },
          method: 'PATCH'
        })
      ),
      400
    );
  });

  it('a floor leaving (or being deleted) prunes the links that named it', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId, mapIds } = await dungeonFixture(db, ownerId);
    const owner = userOf(ownerId);
    await PATCH(
      makeEvent({
        user: owner,
        params: { id: dungeonId },
        body: { links: [stairs()] },
        method: 'PATCH'
      })
    );

    // Floor 1 leaves the dungeon → the staircase to it must not dangle.
    await PATCH_MAP(
      makeEvent({
        user: owner,
        params: { id: mapIds[1] },
        body: { dungeonId: null },
        method: 'PATCH'
      })
    );
    let d = await db.select().from(schema.dungeons).where(eq(schema.dungeons.id, dungeonId));
    expect(d[0].linksJson).toBeNull();

    // Re-join, re-link, then DELETE the floor map outright — same rule.
    await PATCH_MAP(
      makeEvent({
        user: owner,
        params: { id: mapIds[1] },
        body: { dungeonId, floorIdx: 1 },
        method: 'PATCH'
      })
    );
    await PATCH(
      makeEvent({
        user: owner,
        params: { id: dungeonId },
        body: { links: [stairs()] },
        method: 'PATCH'
      })
    );
    await DELETE_MAP(
      makeEvent({ user: owner, params: { id: mapIds[1] }, method: 'DELETE' })
    );
    d = await db.select().from(schema.dungeons).where(eq(schema.dungeons.id, dungeonId));
    expect(d[0].linksJson).toBeNull();
  });

  it('a shrink that strands a link endpoint prunes it too', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const { dungeonId, mapIds } = await dungeonFixture(db, ownerId);
    const owner = userOf(ownerId);
    await PATCH(
      makeEvent({
        user: owner,
        params: { id: dungeonId },
        body: { links: [stairs()] }, // endpoint at (9, 0) on floor 0
        method: 'PATCH'
      })
    );
    // Shrink floor 0 to 5×5: (9, 0) is off the grid now.
    const { encodeRuns } = await import('$lib/board/rle');
    await PATCH_MAP(
      makeEvent({
        user: owner,
        params: { id: mapIds[0] },
        body: { w: 5, h: 5, tiles: encodeRuns(new Array(25).fill(1)) },
        method: 'PATCH'
      })
    );
    const d = await db.select().from(schema.dungeons).where(eq(schema.dungeons.id, dungeonId));
    expect(d[0].linksJson).toBeNull();
  });
});
