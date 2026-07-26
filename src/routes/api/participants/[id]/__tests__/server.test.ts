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
import { PATCH, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username: string) =>
  ({ id, username, isAdmin: false, email: null, emailVerified: false });

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId });
  const participantId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  return { dmId, playerId, encounterId, participantId };
}

describe('PATCH /api/participants/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('lets the DM update HP and initiative', async () => {
    const { dmId, participantId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: participantId },
        body: { currentHp: 3, initiative: 15 }
      })
    );
    expect(res.status).toBe(200);
    const row = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, participantId));
    expect(row[0].currentHp).toBe(3);
    expect(row[0].initiative).toBe(15);
  });

  // Regression: this flat route used to accept writes from any campaign
  // member while its nested twin was DM-only — players could rename
  // monsters, set their HP, and rewrite conditions.
  it('rejects a player member (403)', async () => {
    const { playerId, participantId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId, 'player'),
          params: { id: participantId },
          body: { name: 'Renamed By Player' }
        })
      ),
      403
    );
  });

  it('rejects a non-member (403)', async () => {
    const { participantId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(stranger, 'stranger'),
          params: { id: participantId },
          body: { currentHp: 0 }
        })
      ),
      403
    );
  });
});

describe('DELETE /api/participants/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('lets the DM remove a participant', async () => {
    const { dmId, participantId } = await fixture(db);
    const res = await DELETE(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: participantId }, method: 'DELETE' })
    );
    expect(res.status).toBe(204);
  });

  it('rejects a player member (403)', async () => {
    const { playerId, participantId } = await fixture(db);
    await expectHttpError(
      DELETE(
        makeEvent({ user: userOf(playerId, 'player'), params: { id: participantId }, method: 'DELETE' })
      ),
      403
    );
  });
});
