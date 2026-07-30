import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser, seedCampaign } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { decodeRuns, encodeRuns } from '$lib/board/rle';
import { GET as LIST, POST as INSTANTIATE } from '../+server';
import { DELETE as DESTROY, POST as RESET } from '../[iid]/+server';
import { POST as CREATE_MAP } from '../../../../maps/+server';
import { PATCH as PATCH_MAP } from '../../../../maps/[id]/+server';
import { POST as CREATE_DUNGEON } from '../../../../dungeons/+server';
import { PATCH as PATCH_DUNGEON } from '../../../../dungeons/[id]/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'dm') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId, code } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const dm = userOf(dmId);

  const dungeon = await (
    await CREATE_DUNGEON(makeEvent({ user: dm, body: { name: 'Barrowmaze' } }))
  ).json();
  for (const name of ['Ground', 'Crypts']) {
    const map = await (
      await CREATE_MAP(makeEvent({ user: dm, body: { name, w: 6, h: 4 } }))
    ).json();
    await PATCH_MAP(
      makeEvent({ user: dm, params: { id: map.id }, body: { dungeonId: dungeon.id }, method: 'PATCH' })
    );
  }
  await PATCH_DUNGEON(
    makeEvent({
      user: dm,
      params: { id: dungeon.id },
      body: {
        links: [
          {
            id: 'L1',
            kind: 'stairs',
            a: { floorIdx: 0, x: 5, y: 0 },
            b: { floorIdx: 1, x: 0, y: 3 },
            costFt: 5
          }
        ]
      },
      method: 'PATCH'
    })
  );
  return { dm, player: userOf(playerId, 'player'), campaignId, code, dungeonId: dungeon.id as string };
}

describe('/api/campaigns/[code]/dungeon-instances', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('instantiates a snapshot: floors copied, fog hidden, links carried', async () => {
    const { dm, code, dungeonId } = await fixture(db);
    const res = await INSTANTIATE(
      makeEvent({ user: dm, params: { code }, body: { dungeonId } })
    );
    expect(res.status).toBe(201);
    const inst = await res.json();
    expect(inst.floorCount).toBe(2);

    const floors = await db
      .select()
      .from(schema.instanceFloors)
      .where(eq(schema.instanceFloors.instanceId, inst.id));
    expect(floors).toHaveLength(2);
    for (const f of floors) {
      expect(Array.from(decodeRuns(f.revealedJson, f.w * f.h)).every((b) => b === 0)).toBe(true);
    }
    const iRows = await db
      .select()
      .from(schema.dungeonInstances)
      .where(eq(schema.dungeonInstances.id, inst.id));
    expect(iRows[0].linksJson).toContain('"L1"');
  });

  it('editing the library dungeon afterwards never mutates the instance', async () => {
    const { dm, code, dungeonId } = await fixture(db);
    const inst = await (
      await INSTANTIATE(makeEvent({ user: dm, params: { code }, body: { dungeonId } }))
    ).json();
    // Wipe the library links; the instance keeps its snapshot.
    await PATCH_DUNGEON(
      makeEvent({ user: dm, params: { id: dungeonId }, body: { links: [] }, method: 'PATCH' })
    );
    const iRows = await db
      .select()
      .from(schema.dungeonInstances)
      .where(eq(schema.dungeonInstances.id, inst.id));
    expect(iRows[0].linksJson).toContain('"L1"');
  });

  it('reset re-hides fog and clears notes but keeps terrain, bumping versions', async () => {
    const { dm, code, dungeonId } = await fixture(db);
    const inst = await (
      await INSTANTIATE(makeEvent({ user: dm, params: { code }, body: { dungeonId } }))
    ).json();
    // Simulate a crawl: reveal fog + drop a note + carve terrain on floor 0.
    const carved = encodeRuns([2, ...new Array(23).fill(1)]);
    await db
      .update(schema.instanceFloors)
      .set({
        revealedJson: encodeRuns(new Array(24).fill(1)),
        annotationsJson: JSON.stringify({ '1,1': { note: 'ledge' } }),
        tilesJson: carved
      })
      .where(
        and(eq(schema.instanceFloors.instanceId, inst.id), eq(schema.instanceFloors.floorIdx, 0))
      );

    const res = await RESET(
      makeEvent({ user: dm, params: { code, iid: inst.id }, method: 'POST' })
    );
    expect(res.status).toBe(200);
    const floor = (
      await db
        .select()
        .from(schema.instanceFloors)
        .where(
          and(eq(schema.instanceFloors.instanceId, inst.id), eq(schema.instanceFloors.floorIdx, 0))
        )
    )[0];
    expect(Array.from(decodeRuns(floor.revealedJson, 24)).every((b) => b === 0)).toBe(true);
    expect(floor.annotationsJson).toBeNull();
    expect(floor.tilesJson).toBe(carved); // DM prep survives the reset
    expect(floor.version).toBe(2);
  });

  it('is DM-only in both directions and 400s an empty dungeon', async () => {
    const { dm, player, code, dungeonId } = await fixture(db);
    await expectHttpError(
      INSTANTIATE(makeEvent({ user: player, params: { code }, body: { dungeonId } })),
      403
    );
    await expectHttpError(LIST(makeEvent({ user: player, params: { code } })), 403);

    const empty = await (
      await CREATE_DUNGEON(makeEvent({ user: dm, body: { name: 'Empty' } }))
    ).json();
    await expectHttpError(
      INSTANTIATE(makeEvent({ user: dm, params: { code }, body: { dungeonId: empty.id } })),
      400
    );
  });

  it('deleting an instance unlinks encounters without touching them', async () => {
    const { dm, code, dungeonId, campaignId } = await fixture(db);
    const inst = await (
      await INSTANTIATE(makeEvent({ user: dm, params: { code }, body: { dungeonId } }))
    ).json();
    const encounterId = crypto.randomUUID();
    await db.insert(schema.encounters).values({
      id: encounterId,
      campaignId,
      name: 'Crawl',
      status: 'live',
      round: 1,
      dungeonInstanceId: inst.id,
      createdAt: new Date()
    });
    await DESTROY(makeEvent({ user: dm, params: { code, iid: inst.id }, method: 'DELETE' }));
    const enc = await db
      .select()
      .from(schema.encounters)
      .where(eq(schema.encounters.id, encounterId));
    expect(enc[0].dungeonInstanceId).toBeNull();
    expect(enc[0].status).toBe('live');
  });
});
