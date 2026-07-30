import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { decodeRuns, encodeRuns } from '$lib/board/rle';
import { GET as LIST, POST as CREATE } from '../+server';
import { GET, PATCH, DELETE } from '../[id]/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'owner') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

describe('/api/maps', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('creates a blank all-floor map by default', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const res = await CREATE(
      makeEvent({ user: userOf(ownerId), body: { name: 'Tavern', w: 10, h: 8 } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cellFt).toBe(5);
    expect(Array.from(decodeRuns(body.tiles, 80))).toEqual(new Array(80).fill(1));

    const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, body.id));
    expect(rows[0].ownerUserId).toBe(ownerId);
  });

  it('rejects tiles that do not match the dimensions or the tileset', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    await expectHttpError(
      CREATE(
        makeEvent({
          user: userOf(ownerId),
          body: { name: 'Bad', w: 2, h: 2, tiles: encodeRuns([1, 1, 1]) }
        })
      ),
      400
    );
    await expectHttpError(
      CREATE(
        makeEvent({
          user: userOf(ownerId),
          body: { name: 'Bad', w: 2, h: 2, tiles: encodeRuns([1, 1, 1, 999]) }
        })
      ),
      400
    );
  });

  it('lists only your own maps, tiles omitted', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const otherId = await seedUser(db, { username: 'other' });
    await CREATE(makeEvent({ user: userOf(ownerId), body: { name: 'Mine', w: 4, h: 4 } }));
    await CREATE(makeEvent({ user: userOf(otherId, 'other'), body: { name: 'Theirs', w: 4, h: 4 } }));

    const res = await LIST(makeEvent({ user: userOf(ownerId) }));
    const body = await res.json();
    expect(body.maps).toHaveLength(1);
    expect(body.maps[0].name).toBe('Mine');
    expect(body.maps[0].tiles).toBeUndefined();
  });

  it('is owner-only for read, edit and delete', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const otherId = await seedUser(db, { username: 'other' });
    const created = await (
      await CREATE(makeEvent({ user: userOf(ownerId), body: { name: 'Mine', w: 4, h: 4 } }))
    ).json();

    const stranger = userOf(otherId, 'other');
    await expectHttpError(GET(makeEvent({ user: stranger, params: { id: created.id } })), 403);
    await expectHttpError(
      PATCH(makeEvent({ user: stranger, params: { id: created.id }, body: { name: 'Stolen' }, method: 'PATCH' })),
      403
    );
    await expectHttpError(
      DELETE(makeEvent({ user: stranger, params: { id: created.id }, method: 'DELETE' })),
      403
    );
  });

  it('saves a paint (tiles round-trip) and validates resize consistency', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const created = await (
      await CREATE(makeEvent({ user: userOf(ownerId), body: { name: 'Mine', w: 2, h: 2 } }))
    ).json();

    const painted = encodeRuns([1, 2, 2, 1]);
    const res = await PATCH(
      makeEvent({
        user: userOf(ownerId),
        params: { id: created.id },
        body: { tiles: painted },
        method: 'PATCH'
      })
    );
    expect((await res.json()).tiles).toBe(painted);

    // Resize without a matching tile string is a 400, not a corrupt row.
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(ownerId),
          params: { id: created.id },
          body: { w: 3 },
          method: 'PATCH'
        })
      ),
      400
    );

    const resized = await PATCH(
      makeEvent({
        user: userOf(ownerId),
        params: { id: created.id },
        body: { w: 3, h: 1, tiles: encodeRuns([1, 1, 2]) },
        method: 'PATCH'
      })
    );
    const body = await resized.json();
    expect([body.w, body.h]).toEqual([3, 1]);
  });

  it('deletes a map', async () => {
    const ownerId = await seedUser(db, { username: 'owner' });
    const created = await (
      await CREATE(makeEvent({ user: userOf(ownerId), body: { name: 'Mine', w: 2, h: 2 } }))
    ).json();
    const res = await DELETE(
      makeEvent({ user: userOf(ownerId), params: { id: created.id }, method: 'DELETE' })
    );
    expect(res.status).toBe(200);
    const rows = await db.select().from(schema.maps).where(eq(schema.maps.id, created.id));
    expect(rows).toHaveLength(0);
  });
});
