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
import { subscribe, subscriberCount } from '$lib/server/realtime/hub';
import { POST, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

async function dmFixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId } = await seedCampaign(db, { dmId });
  const encounterId = await seedEncounter(db, { campaignId });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin' });
  return { dmId, campaignId, encounterId, monsterId };
}

async function playerFixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const characterId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    name: 'Hero'
  });
  const encounterId = await seedEncounter(db, { campaignId });
  const pcParticipantId = await seedParticipant(db, {
    encounterId,
    kind: 'pc',
    name: 'Hero',
    characterId
  });
  return { dmId, playerId, encounterId, pcParticipantId, characterId };
}

const PLAN_BODY = {
  plan: {
    actionId: 'longsword',
    actionLabel: 'Longsword (action)',
    targetParticipantIds: [],
    notes: '',
    updatedAt: 1700000000000
  }
};

describe('POST /api/encounters/[id]/participants/[pid]/plan', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  // Locks the happy round-trip — the exact regression that bit twice this
  // session. DM picks a plan, the JSON column lands, the SSE hub receives
  // a `plan` event with the payload intact.
  it('writes planJson + publishes a plan event when the DM POSTs', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);

    // Wire up an SSE listener so we can assert the publish().
    const stream = subscribe(`encounter:${encounterId}`);
    expect(subscriberCount(`encounter:${encounterId}`)).toBe(1);

    const event = makeEvent({
      user: { id: dmId, username: 'dm', isAdmin: false },
      params: { id: encounterId, pid: monsterId },
      body: PLAN_BODY
    });
    const res = await POST(event);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(rows[0].planJson).toBeTruthy();
    const stored = JSON.parse(rows[0].planJson!);
    expect(stored.actionId).toBe('longsword');
    expect(stored.actionLabel).toBe('Longsword (action)');

    // Drain the SSE frame to confirm fan-out fired.
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (let i = 0; i < 3; i++) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 25)
        )
      ]);
      if (chunk.done) break;
      if (chunk.value) text += decoder.decode(chunk.value);
    }
    reader.releaseLock();
    expect(text).toContain('"type":"plan"');
    expect(text).toContain('"actionId":"longsword"');
  });

  // Locks the role gate. Players cannot plan on non-PC participants —
  // every monster row would be DM-controllable otherwise.
  it('rejects a player who tries to plan for a non-PC participant', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const encounterId = await seedEncounter(db, { campaignId });
    const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });

    await expectHttpError(
      POST(
        makeEvent({
          user: { id: playerId, username: 'p', isAdmin: false },
          params: { id: encounterId, pid: monsterId },
          body: PLAN_BODY
        })
      ),
      403
    );
  });

  // Locks the PC-ownership gate. A player can only plan for their own PC.
  it('rejects a player planning for another player\'s PC', async () => {
    const { encounterId, pcParticipantId } = await playerFixture(db);
    const otherPlayer = await seedUser(db, { username: 'intruder' });

    await expectHttpError(
      POST(
        makeEvent({
          user: { id: otherPlayer, username: 'intruder', isAdmin: false },
          params: { id: encounterId, pid: pcParticipantId },
          body: PLAN_BODY
        })
      ),
      403
    );
  });

  // Locks the auth requirement.
  it('returns 401 when no user is on locals', async () => {
    const { encounterId, monsterId } = await dmFixture(db);
    await expectHttpError(
      POST(
        makeEvent({ user: null, params: { id: encounterId, pid: monsterId }, body: PLAN_BODY })
      ),
      401
    );
  });

  // Locks Zod validation — malformed body → 400, not silent acceptance.
  it('returns 400 on a malformed plan body', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);
    await expectHttpError(
      POST(
        makeEvent({
          user: { id: dmId, username: 'dm', isAdmin: false },
          params: { id: encounterId, pid: monsterId },
          body: { plan: { actionId: 123 } } // wrong type
        })
      ),
      400
    );
  });
});

describe('DELETE /api/encounters/[id]/participants/[pid]/plan', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('clears planJson when the DM DELETEs', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);
    // Seed an existing plan.
    await db
      .update(schema.participants)
      .set({ planJson: JSON.stringify(PLAN_BODY.plan) })
      .where(eq(schema.participants.id, monsterId));

    const res = await DELETE(
      makeEvent({
        user: { id: dmId, username: 'dm', isAdmin: false },
        params: { id: encounterId, pid: monsterId },
        method: 'DELETE'
      })
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(rows[0].planJson).toBeNull();
  });
});
