import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedEncounter,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const characterId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    linkToCampaign: true
  });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const pcId = await seedParticipant(db, { encounterId, kind: 'pc', characterId, name: 'Hero' });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  return {
    dm: userOf(dmId, 'dm'),
    player: userOf(playerId, 'player'),
    encounterId,
    pcId,
    monsterId
  };
}

async function positionOf(db: Db, pid: string) {
  const rows = await db
    .select({ posX: schema.participants.posX, posY: schema.participants.posY })
    .from(schema.participants)
    .where(eq(schema.participants.id, pid));
  return rows[0];
}

describe('POST /api/encounters/[id]/participants/[pid]/position', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('DM moves anyone; player moves their own PC', async () => {
    const { dm, player, encounterId, pcId, monsterId } = await fixture(db);

    const dmMove = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid: monsterId }, body: { x: 4, y: 2 } })
    );
    expect(dmMove.status).toBe(200);
    expect(await positionOf(db, monsterId)).toEqual({ posX: 4, posY: 2 });

    const playerMove = await POST(
      makeEvent({ user: player, params: { id: encounterId, pid: pcId }, body: { x: 1, y: 1 } })
    );
    expect(playerMove.status).toBe(200);
    expect(await positionOf(db, pcId)).toEqual({ posX: 1, posY: 1 });
  });

  it('players never move non-PC tokens', async () => {
    const { player, encounterId, monsterId } = await fixture(db);
    await expectHttpError(
      POST(
        makeEvent({ user: player, params: { id: encounterId, pid: monsterId }, body: { x: 0, y: 0 } })
      ),
      403
    );
  });

  it('clears a token with both nulls, and rejects a half-null body', async () => {
    const { dm, encounterId, monsterId } = await fixture(db);
    await POST(makeEvent({ user: dm, params: { id: encounterId, pid: monsterId }, body: { x: 4, y: 2 } }));
    const res = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid: monsterId }, body: { x: null, y: null } })
    );
    expect(res.status).toBe(200);
    expect(await positionOf(db, monsterId)).toEqual({ posX: null, posY: null });

    await expectHttpError(
      POST(makeEvent({ user: dm, params: { id: encounterId, pid: monsterId }, body: { x: 3, y: null } })),
      400
    );
  });

  it('keeps the whole footprint on the attached board', async () => {
    const { dm, encounterId } = await fixture(db);
    const largeId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Ogre',
      sizeCells: 2
    });
    await db.insert(schema.encounterBoards).values({
      encounterId,
      w: 4,
      h: 4,
      cellFt: 5,
      tilesJson: '1x16',
      revealedJson: '0x16',
      version: 1,
      updatedAt: new Date()
    });

    await expectHttpError(
      POST(makeEvent({ user: dm, params: { id: encounterId, pid: largeId }, body: { x: 3, y: 3 } })),
      400
    );
    const ok = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid: largeId }, body: { x: 2, y: 2 } })
    );
    expect(ok.status).toBe(200);
  });

  it('accepts pre-placement moves when no board is attached', async () => {
    const { dm, encounterId, monsterId } = await fixture(db);
    const res = await POST(
      makeEvent({ user: dm, params: { id: encounterId, pid: monsterId }, body: { x: 50, y: 50 } })
    );
    expect(res.status).toBe(200);
  });
});
