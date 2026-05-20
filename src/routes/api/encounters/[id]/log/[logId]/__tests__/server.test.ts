import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedActionLog
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { PATCH, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

async function fixture(db: Db, opts: { withPlayer?: boolean } = {}) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = opts.withPlayer ? await seedUser(db, { username: 'p' }) : undefined;
  const { campaignId } = await seedCampaign(db, {
    dmId,
    playerIds: playerId ? [playerId] : []
  });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  const logId = await seedActionLog(db, {
    encounterId,
    submittedByUserId: dmId,
    submitterRole: 'dm',
    participantId: monsterId,
    actionLabel: 'Slash',
    attackRoll: 12,
    damageRoll: 5,
    hit: 'hit',
    notes: 'first take'
  });
  return { dmId, playerId, encounterId, monsterId, logId };
}

const userOf = (id: string, name = 'u') => ({ id, username: name, isAdmin: false, email: null, emailVerified: false });

describe('PATCH /api/encounters/[id]/log/[logId]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('overwrites the mutable fields on an existing entry', async () => {
    const { dmId, encounterId, logId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId, logId },
        body: {
          actionLabel: 'Slash (corrected)',
          attackRoll: 18,
          damageRoll: 9,
          hit: 'crit',
          notes: 'rerolled the d20'
        }
      })
    );
    const body = await res.json();
    expect(body.id).toBe(logId);
    expect(body.actionLabel).toBe('Slash (corrected)');
    expect(body.attackRoll).toBe(18);
    expect(body.damageRoll).toBe(9);
    expect(body.hit).toBe('crit');
    expect(body.notes).toBe('rerolled the d20');

    // No new row appended — count remains 1.
    const rows = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(rows.length).toBe(1);
  });

  // The original participantId / actionId / submitter attribution stays
  // frozen on a PATCH so audit history is preserved.
  it('does not let PATCH change participantId / actionId / submitter attribution', async () => {
    const { dmId, encounterId, logId, monsterId } = await fixture(db);
    await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId, logId },
        body: {
          // The schema doesn't allow these fields — extra keys are stripped
          // by Zod's default behavior; assert that the row didn't move.
          participantId: '11111111-1111-4111-8111-111111111111',
          actionId: 'changed',
          submittedByUserId: '11111111-1111-4111-8111-111111111111',
          actionLabel: 'still updates'
        }
      })
    );
    const after = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.id, logId))
      .limit(1);
    expect(after[0].participantId).toBe(monsterId);
    expect(after[0].actionId).toBe('test');
    expect(after[0].submittedByUserId).toBe(dmId);
    expect(after[0].actionLabel).toBe('still updates');
  });

  it('rejects PATCH from a non-DM member (403)', async () => {
    const { playerId, encounterId, logId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(playerId!, 'p'),
          params: { id: encounterId, logId },
          body: { actionLabel: 'nope' }
        })
      ),
      403
    );
  });

  it('rejects PATCH from a non-member (403)', async () => {
    const { encounterId, logId } = await fixture(db);
    const otherId = await seedUser(db, { username: 'other' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(otherId, 'other'),
          params: { id: encounterId, logId },
          body: { actionLabel: 'nope' }
        })
      ),
      403
    );
  });

  it('returns 404 when the log entry is for a different encounter', async () => {
    const { dmId, encounterId, logId } = await fixture(db);
    // Spin up a second encounter under the same DM
    const otherCampaign = await seedCampaign(db, { dmId });
    const otherEncounter = await seedEncounter(db, { campaignId: otherCampaign.campaignId });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(dmId, 'dm'),
          params: { id: otherEncounter, logId },
          body: { actionLabel: 'wrong encounter' }
        })
      ),
      404
    );
  });
});

describe('DELETE /api/encounters/[id]/log/[logId]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('removes the row and returns 204', async () => {
    const { dmId, encounterId, logId } = await fixture(db);
    const res = await DELETE(
      makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId, logId } })
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.id, logId));
    expect(rows.length).toBe(0);
  });

  it('rejects DELETE from a non-DM member (403)', async () => {
    const { playerId, encounterId, logId } = await fixture(db, { withPlayer: true });
    await expectHttpError(
      DELETE(
        makeEvent({ user: userOf(playerId!, 'p'), params: { id: encounterId, logId } })
      ),
      403
    );
  });

  it('returns 404 for a nonexistent log entry', async () => {
    const { dmId, encounterId } = await fixture(db);
    await expectHttpError(
      DELETE(
        makeEvent({
          user: userOf(dmId, 'dm'),
          params: { id: encounterId, logId: '11111111-1111-4111-8111-111111111111' }
        })
      ),
      404
    );
  });
});
