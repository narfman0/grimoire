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

const dmOf = (id: string) => ({ id, username: 'dm', isAdmin: false });

describe('POST /api/encounters/[id]/participants/[pid]/conditions', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('writes the new conditions list to the non-PC participant', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const res = await POST(
      makeEvent({
        user: dmOf(dmId),
        params: { id: encounterId, pid: monsterId },
        body: { conditions: ['frightened', 'prone'] }
      })
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(JSON.parse(rows[0].conditionsJson)).toEqual(['frightened', 'prone']);
  });

  it('rejects writes on a PC participant (400)', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const characterId = await seedCharacter(db, { campaignId, ownerUserId: playerId });
    const encounterId = await seedEncounter(db, { campaignId });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId
    });
    await expectHttpError(
      POST(
        makeEvent({
          user: dmOf(dmId),
          params: { id: encounterId, pid: pcId },
          body: { conditions: ['frightened'] }
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
          user: { id: stranger, username: 'stranger', isAdmin: false },
          params: { id: encounterId, pid: monsterId },
          body: { conditions: [] }
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
          body: { conditions: [] }
        })
      ),
      401
    );
  });
});
