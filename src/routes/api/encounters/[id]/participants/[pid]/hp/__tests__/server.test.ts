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

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId } = await seedCampaign(db, { dmId });
  const encounterId = await seedEncounter(db, { campaignId });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });
  return { dmId, encounterId, monsterId };
}

const dmOf = (id: string) => ({ id, username: 'dm', isAdmin: false, email: null, emailVerified: false });

describe('POST /api/encounters/[id]/participants/[pid]/hp', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('updates current/temp/max HP for a non-PC participant', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const res = await POST(
      makeEvent({
        user: dmOf(dmId),
        params: { id: encounterId, pid: monsterId },
        body: { currentHp: 3, tempHp: 5, maxHp: 12 }
      })
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(rows[0].currentHp).toBe(3);
    expect(rows[0].tempHp).toBe(5);
    expect(rows[0].maxHp).toBe(12);
  });

  // Locks the PC-HP-source-of-truth gate. The participants row intentionally
  // stays null for PCs; HP lives on the character document. Allowing a
  // write here would create a stale shadow value.
  it('rejects HP writes on a PC participant (400)', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const characterId = await seedCharacter(db, { campaignId, ownerUserId: playerId });
    const encounterId = await seedEncounter(db, { campaignId });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId,
      name: 'Hero'
    });
    await expectHttpError(
      POST(
        makeEvent({
          user: dmOf(dmId),
          params: { id: encounterId, pid: pcId },
          body: { currentHp: 0 }
        })
      ),
      400
    );
  });

  it('returns 403 for a non-member', async () => {
    const { encounterId, monsterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      POST(
        makeEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { id: encounterId, pid: monsterId },
          body: { currentHp: 0 }
        })
      ),
      403
    );
  });

  it('returns 401 without a session', async () => {
    const { encounterId, monsterId } = await fixture(db);
    await expectHttpError(
      POST(
        makeEvent({
          user: null,
          params: { id: encounterId, pid: monsterId },
          body: { currentHp: 0 }
        })
      ),
      401
    );
  });

  it('partial body: only updates the fields provided', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    await POST(
      makeEvent({
        user: dmOf(dmId),
        params: { id: encounterId, pid: monsterId },
        body: { tempHp: 7 } // only temp
      })
    );
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(rows[0].tempHp).toBe(7);
    expect(rows[0].currentHp).toBe(10); // unchanged from seed default
    expect(rows[0].maxHp).toBe(10);
  });
});
