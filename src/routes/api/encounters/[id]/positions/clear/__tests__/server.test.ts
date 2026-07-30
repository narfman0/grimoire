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
  const outsiderId = await seedUser(db, { username: 'outsider' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  return {
    dm: userOf(dmId, 'dm'),
    player: userOf(playerId, 'player'),
    outsider: userOf(outsiderId, 'outsider'),
    encounterId
  };
}

const positions = async (db: Db, encounterId: string) =>
  (
    await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.encounterId, encounterId))
  ).map((r) => [r.posX, r.posY]);

describe('POST /api/encounters/[id]/positions/clear', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('takes every token off the board in one write', async () => {
    const { dm, encounterId } = await fixture(db);
    await seedParticipant(db, { encounterId, kind: 'monster', posX: 1, posY: 1 });
    await seedParticipant(db, { encounterId, kind: 'monster', posX: 4, posY: 2 });
    const res = await POST(makeEvent({ user: dm, params: { id: encounterId }, method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: 2 });
    expect(await positions(db, encounterId)).toEqual([
      [null, null],
      [null, null]
    ]);
  });

  it('counts only the tokens that were actually placed', async () => {
    const { dm, encounterId } = await fixture(db);
    await seedParticipant(db, { encounterId, kind: 'monster', posX: 1, posY: 1 });
    await seedParticipant(db, { encounterId, kind: 'monster' }); // never placed
    const res = await POST(makeEvent({ user: dm, params: { id: encounterId }, method: 'POST' }));
    expect(await res.json()).toEqual({ cleared: 1 });
  });

  it('is a no-op on an empty board', async () => {
    const { dm, encounterId } = await fixture(db);
    const res = await POST(makeEvent({ user: dm, params: { id: encounterId }, method: 'POST' }));
    expect(await res.json()).toEqual({ cleared: 0 });
  });

  it('leaves other encounters alone', async () => {
    const { dm, encounterId } = await fixture(db);
    const otherEncounterId = await seedEncounter(db, {
      campaignId: (
        await db.select().from(schema.encounters).where(eq(schema.encounters.id, encounterId))
      )[0].campaignId,
      status: 'live'
    });
    await seedParticipant(db, { encounterId, kind: 'monster', posX: 1, posY: 1 });
    await seedParticipant(db, { encounterId: otherEncounterId, kind: 'monster', posX: 5, posY: 5 });
    await POST(makeEvent({ user: dm, params: { id: encounterId }, method: 'POST' }));
    expect(await positions(db, otherEncounterId)).toEqual([[5, 5]]);
  });

  it('is DM-only, and 404s for an unknown encounter', async () => {
    const { player, outsider, encounterId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: player, params: { id: encounterId }, method: 'POST' })),
      403
    );
    await expectHttpError(
      POST(makeEvent({ user: outsider, params: { id: encounterId }, method: 'POST' })),
      403
    );
    await expectHttpError(
      POST(
        makeEvent({
          user: player,
          params: { id: '11111111-1111-4111-8111-111111111111' },
          method: 'POST'
        })
      ),
      404
    );
  });
});
