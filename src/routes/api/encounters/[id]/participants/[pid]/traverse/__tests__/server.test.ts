import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { encodeRuns } from '$lib/board/rle';
import { instantiateDungeon } from '$lib/server/encounter/dungeon';
import { POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Two 6×4 floors; stairs (5,0)@0 ⇄ (0,3)@1; one-way chute (1,1)@0 → (2,2)@1. */
async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const dungeonId = crypto.randomUUID();
  await db.insert(schema.dungeons).values({
    id: dungeonId,
    ownerUserId: dmId,
    name: 'Barrowmaze',
    linksJson: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const instanceId = await instantiateDungeon(
    campaignId,
    {
      id: dungeonId,
      name: 'Barrowmaze',
      linksJson: JSON.stringify([
        { id: 'L1', kind: 'stairs', a: { floorIdx: 0, x: 5, y: 0 }, b: { floorIdx: 1, x: 0, y: 3 }, costFt: 5 },
        { id: 'L2', kind: 'hatch', a: { floorIdx: 0, x: 1, y: 1 }, b: { floorIdx: 1, x: 2, y: 2 }, costFt: 5, oneWay: true }
      ])
    },
    [0, 1].map((floorIdx) => ({
      floorIdx,
      name: floorIdx === 0 ? 'Ground' : 'Crypts',
      w: 6,
      h: 4,
      cellFt: 5,
      tilesJson: encodeRuns(new Array(24).fill(1)),
      backgroundPath: null
    }))
  );
  await db
    .update(schema.encounters)
    .set({ dungeonInstanceId: instanceId })
    .where(eq(schema.encounters.id, encounterId));
  return { dm: userOf(dmId, 'dm'), player: userOf(playerId, 'player'), encounterId, instanceId };
}

const posOf = async (db: Db, pid: string) => {
  const r = (await db.select().from(schema.participants).where(eq(schema.participants.id, pid)))[0];
  return [r.posX, r.posY, r.posFloor];
};

describe('POST /api/encounters/[id]/participants/[pid]/traverse', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('moves the token to the far end and logs it', async () => {
    const { dm, encounterId } = await fixture(db);
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin',
      posX: 5,
      posY: 0
    });
    const res = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid }, body: { linkId: 'L1' } })
    );
    expect(await res.json()).toEqual({ ok: true, x: 0, y: 3, floor: 1 });
    expect(await posOf(db, pid)).toEqual([0, 3, 1]);

    const log = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(log).toHaveLength(1);
    expect(log[0].actionLabel).toContain('stairs');
    expect(log[0].actionLabel).toContain('Crypts');
  });

  it('works from either end of a two-way link', async () => {
    const { dm, encounterId } = await fixture(db);
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin',
      posX: 0,
      posY: 3
    });
    await db.update(schema.participants).set({ posFloor: 1 }).where(eq(schema.participants.id, pid));
    await POST(makeEvent({ user: dm, params: { id: encounterId, pid }, body: { linkId: 'L1' } }));
    expect(await posOf(db, pid)).toEqual([5, 0, 0]);
  });

  it('refuses a one-way link taken backwards, and a token not on the endpoint', async () => {
    const { dm, encounterId } = await fixture(db);
    const below = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Below',
      posX: 2,
      posY: 2
    });
    await db
      .update(schema.participants)
      .set({ posFloor: 1 })
      .where(eq(schema.participants.id, below));
    await expectHttpError(
      POST(makeEvent({ user: dm, params: { id: encounterId, pid: below }, body: { linkId: 'L2' } })),
      400
    );
    const wanderer = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Wanderer',
      posX: 3,
      posY: 3
    });
    await expectHttpError(
      POST(
        makeEvent({ user: dm, params: { id: encounterId, pid: wanderer }, body: { linkId: 'L1' } })
      ),
      400
    );
  });

  it('clamps a big token inside the destination grid', async () => {
    const { dm, encounterId } = await fixture(db);
    const ogre = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Ogre',
      posX: 5,
      posY: 0,
      sizeCells: 3
    });
    // Exit is (0,3) on a 6×4 floor: y clamps to 1 so the 3×3 footprint fits.
    const res = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid: ogre }, body: { linkId: 'L1' } })
    );
    expect(await res.json()).toEqual({ ok: true, x: 0, y: 1, floor: 1 });
  });

  it('404s an unknown link and 400s with no dungeon or unplaced token', async () => {
    const { dm, encounterId } = await fixture(db);
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin',
      posX: 5,
      posY: 0
    });
    await expectHttpError(
      POST(makeEvent({ user: dm, params: { id: encounterId, pid }, body: { linkId: 'nope' } })),
      404
    );
    const unplaced = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Ghost' });
    await expectHttpError(
      POST(
        makeEvent({ user: dm, params: { id: encounterId, pid: unplaced }, body: { linkId: 'L1' } })
      ),
      400
    );
  });

  it('players cannot traverse non-PC tokens', async () => {
    const { player, encounterId } = await fixture(db);
    const pid = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin',
      posX: 5,
      posY: 0
    });
    await expectHttpError(
      POST(makeEvent({ user: player, params: { id: encounterId, pid }, body: { linkId: 'L1' } })),
      403
    );
  });
});
