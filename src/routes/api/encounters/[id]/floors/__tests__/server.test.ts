import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { decodeRuns, encodeRuns } from '$lib/board/rle';
import { instantiateDungeon } from '$lib/server/encounter/dungeon';
import { GET, PATCH } from '../[idx]/+server';
import { PUT as ATTACH_DUNGEON, DELETE as DETACH_DUNGEON } from '../../dungeon/+server';
import { PUT as ATTACH_BOARD } from '../../board/+server';
import { POST as SET_POSITION } from '../../participants/[pid]/position/+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Campaign + live encounter + a 2-floor instance (6×4 floors, one link). */
async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });

  const dungeonId = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.dungeons).values({
    id: dungeonId,
    ownerUserId: dmId,
    name: 'Barrowmaze',
    linksJson: JSON.stringify([
      {
        id: 'L1',
        kind: 'stairs',
        a: { floorIdx: 0, x: 5, y: 0 },
        b: { floorIdx: 1, x: 0, y: 3 },
        costFt: 5
      }
    ]),
    createdAt: now,
    updatedAt: now
  });
  const instanceId = await instantiateDungeon(
    campaignId,
    { id: dungeonId, name: 'Barrowmaze', linksJson: JSON.stringify([]) },
    [
      { floorIdx: 0, name: 'Ground', w: 6, h: 4, cellFt: 5, tilesJson: encodeRuns(new Array(24).fill(1)), backgroundPath: '/api/map-backgrounds/x' },
      { floorIdx: 1, name: 'Crypts', w: 6, h: 4, cellFt: 5, tilesJson: encodeRuns(new Array(24).fill(1)), backgroundPath: null }
    ]
  );
  await db
    .update(schema.encounters)
    .set({ dungeonInstanceId: instanceId })
    .where(eq(schema.encounters.id, encounterId));

  return {
    dm: userOf(dmId, 'dm'),
    player: userOf(playerId, 'player'),
    campaignId,
    encounterId,
    instanceId
  };
}

const revealFloor = async (db: Db, instanceId: string, idx: number, bits: number[]) =>
  db
    .update(schema.instanceFloors)
    .set({ revealedJson: encodeRuns(bits) })
    .where(
      and(eq(schema.instanceFloors.instanceId, instanceId), eq(schema.instanceFloors.floorIdx, idx))
    );

describe('/api/encounters/[id]/floors/[idx]', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('DM reads any floor unmasked; players get fog-masked tiles and no background', async () => {
    const { dm, player, encounterId, instanceId } = await fixture(db);
    const dmFloor = await (
      await GET(makeEvent({ user: dm, params: { id: encounterId, idx: '0' } }))
    ).json();
    expect(dmFloor.background).toBe('/api/map-backgrounds/x');
    expect(Array.from(decodeRuns(dmFloor.tiles, 24)).every((t) => t === 1)).toBe(true);

    // Reveal one cell → the floor exists for players, masked.
    await revealFloor(db, instanceId, 0, [1, ...new Array(23).fill(0)]);
    const pFloor = await (
      await GET(makeEvent({ user: player, params: { id: encounterId, idx: '0' } }))
    ).json();
    expect(pFloor.background).toBeNull();
    const tiles = Array.from(decodeRuns(pFloor.tiles, 24));
    expect(tiles[0]).toBe(1);
    expect(tiles.slice(1).every((t) => t === 0)).toBe(true);
  });

  it('a fully-fogged floor is a 404 for players — existence is information', async () => {
    const { player, encounterId } = await fixture(db);
    await expectHttpError(
      GET(makeEvent({ user: player, params: { id: encounterId, idx: '1' } })),
      404
    );
    // Same status as a floor that genuinely doesn't exist: probing indexes
    // reveals nothing about how deep the dungeon goes.
    await expectHttpError(
      GET(makeEvent({ user: player, params: { id: encounterId, idx: '9' } })),
      404
    );
  });

  it('PATCH bumps the floor version and the instance version', async () => {
    const { dm, encounterId, instanceId } = await fixture(db);
    const before = (
      await db
        .select()
        .from(schema.dungeonInstances)
        .where(eq(schema.dungeonInstances.id, instanceId))
    )[0];
    const updated = await (
      await PATCH(
        makeEvent({
          user: dm,
          params: { id: encounterId, idx: '0' },
          body: { revealed: encodeRuns(new Array(24).fill(1)) },
          method: 'PATCH'
        })
      )
    ).json();
    expect(updated.version).toBe(2);
    const after = (
      await db
        .select()
        .from(schema.dungeonInstances)
        .where(eq(schema.dungeonInstances.id, instanceId))
    )[0];
    expect(after.version).toBe(before.version + 1);
  });

  it('PATCH is DM-only and validates payloads against the floor grid', async () => {
    const { dm, player, encounterId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: player,
          params: { id: encounterId, idx: '0' },
          body: { revealed: encodeRuns(new Array(24).fill(1)) },
          method: 'PATCH'
        })
      ),
      403
    );
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dm,
          params: { id: encounterId, idx: '0' },
          body: { revealed: encodeRuns(new Array(9).fill(1)) }, // wrong size
          method: 'PATCH'
        })
      ),
      400
    );
  });
});

describe('dungeon attach exclusivity + floor-aware positions', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('quick board and dungeon are mutually exclusive, both ways', async () => {
    const { dm, encounterId, instanceId } = await fixture(db);
    // Dungeon attached (fixture) → board PUT 409s.
    await expectHttpError(
      ATTACH_BOARD(
        makeEvent({ user: dm, params: { id: encounterId }, body: { w: 4, h: 4 }, method: 'PUT' })
      ),
      409
    );
    // Detach the dungeon → board attaches; now the dungeon PUT 409s.
    await DETACH_DUNGEON(makeEvent({ user: dm, params: { id: encounterId }, method: 'DELETE' }));
    await ATTACH_BOARD(
      makeEvent({ user: dm, params: { id: encounterId }, body: { w: 4, h: 4 }, method: 'PUT' })
    );
    await expectHttpError(
      ATTACH_DUNGEON(
        makeEvent({ user: dm, params: { id: encounterId }, body: { instanceId }, method: 'PUT' })
      ),
      409
    );
  });

  it('positions bounds-check against the named floor and persist it', async () => {
    const { dm, encounterId } = await fixture(db);
    const pid = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
    const ok = await SET_POSITION(
      makeEvent({
        user: dm,
        params: { id: encounterId, pid },
        body: { x: 2, y: 3, floor: 1 }
      })
    );
    expect(ok.status).toBe(200);
    let row = (await db.select().from(schema.participants).where(eq(schema.participants.id, pid)))[0];
    expect([row.posX, row.posY, row.posFloor]).toEqual([2, 3, 1]);

    // Off the 6×4 grid → 400; a floor that doesn't exist → 400.
    await expectHttpError(
      SET_POSITION(
        makeEvent({ user: dm, params: { id: encounterId, pid }, body: { x: 6, y: 0, floor: 1 } })
      ),
      400
    );
    await expectHttpError(
      SET_POSITION(
        makeEvent({ user: dm, params: { id: encounterId, pid }, body: { x: 0, y: 0, floor: 9 } })
      ),
      400
    );

    // Clearing also clears the floor.
    await SET_POSITION(
      makeEvent({ user: dm, params: { id: encounterId, pid }, body: { x: null, y: null } })
    );
    row = (await db.select().from(schema.participants).where(eq(schema.participants.id, pid)))[0];
    expect([row.posX, row.posY, row.posFloor]).toEqual([null, null, null]);
  });
});
