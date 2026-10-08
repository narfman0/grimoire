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

const asUser = (id: string, username: string) => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const characterId = await seedCharacter(db, { campaignId, ownerUserId: playerId, name: 'Ogila' });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const pcId = await seedParticipant(db, { encounterId, kind: 'pc', name: 'Ogila', characterId });
  const goblinId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  return { dmId, playerId, encounterId, pcId, goblinId };
}

async function initiativeOf(db: Db, id: string) {
  const rows = await db.select().from(schema.participants).where(eq(schema.participants.id, id));
  return rows[0].initiative;
}

describe('POST /api/encounters/[id]/participants/[pid]/initiative', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  // Regression: initiative was only writable through the DM-only participant
  // PATCH, so a player could not enter their own roll.
  it("lets a player set their own PC's initiative", async () => {
    const { playerId, encounterId, pcId } = await fixture(db);
    const res = await POST(
      makeEvent({
        user: asUser(playerId, 'player'),
        params: { id: encounterId, pid: pcId },
        body: { initiative: 17 }
      })
    );
    expect(res.status).toBe(200);
    expect(await initiativeOf(db, pcId)).toBe(17);
  });

  it('lets the DM set and clear any initiative', async () => {
    const { dmId, encounterId, goblinId } = await fixture(db);
    const user = asUser(dmId, 'dm');
    await POST(makeEvent({ user, params: { id: encounterId, pid: goblinId }, body: { initiative: 9 } }));
    expect(await initiativeOf(db, goblinId)).toBe(9);
    await POST(makeEvent({ user, params: { id: encounterId, pid: goblinId }, body: { initiative: null } }));
    expect(await initiativeOf(db, goblinId)).toBeNull();
  });

  it("rejects a player setting a monster's initiative", async () => {
    const { playerId, encounterId, goblinId } = await fixture(db);
    await expectHttpError(
      POST(
        makeEvent({
          user: asUser(playerId, 'player'),
          params: { id: encounterId, pid: goblinId },
          body: { initiative: 20 }
        })
      ),
      403
    );
    expect(await initiativeOf(db, goblinId)).toBeNull();
  });

  it('rejects a non-integer roll', async () => {
    const { playerId, encounterId, pcId } = await fixture(db);
    await expectHttpError(
      POST(
        makeEvent({
          user: asUser(playerId, 'player'),
          params: { id: encounterId, pid: pcId },
          body: { initiative: 12.5 }
        })
      ),
      400
    );
  });
});
