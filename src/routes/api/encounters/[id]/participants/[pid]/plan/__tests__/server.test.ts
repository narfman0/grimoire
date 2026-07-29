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

  // Locks the happy round-trip: DM picks a plan and the JSON column lands.
  // Polling clients pick up the change on their next GET /api/encounters/[id]/state.
  it('writes planJson when the DM POSTs', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);

    const event = makeEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
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
  });

  // The NPC spell-slot tracker persists through this endpoint (plan_json's
  // `combat` slot), so the validator has to accept the level-keyed table —
  // and bound it, since plan_json is client-supplied.
  it('accepts an NPC spell-slot table and rejects a bogus level key', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);
    const user = { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false };
    const withSlots = {
      plan: {
        ...PLAN_BODY.plan,
        combat: { legendaryUsed: 1, round: 2, spellSlots: { '3': { max: 3, used: 2 } } }
      }
    };

    const res = await POST(
      makeEvent({ user, params: { id: encounterId, pid: monsterId }, body: withSlots })
    );
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    expect(JSON.parse(rows[0].planJson!).combat.spellSlots).toEqual({ '3': { max: 3, used: 2 } });

    await expectHttpError(
      POST(
        makeEvent({
          user,
          params: { id: encounterId, pid: monsterId },
          body: {
            plan: {
              ...PLAN_BODY.plan,
              combat: { spellSlots: { junk: { max: 3, used: 2 } } }
            }
          }
        })
      ),
      400
    );
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
          user: { id: playerId, username: 'p', isAdmin: false, email: null, emailVerified: false },
          params: { id: encounterId, pid: monsterId },
          body: PLAN_BODY
        })
      ),
      403
    );
  });

  // Membership is the outer boundary and is not a campaign policy: a
  // non-member is refused whatever the permissions say.
  //
  // (This test used to be named "rejects a player planning for another
  // player's PC" and described as locking the PC-ownership gate. It never
  // did: `intruder` was seeded but never added to the campaign, so it was
  // failing on membership the whole time. The ownership question it claimed
  // to cover is the test below.)
  it('rejects a non-member planning for a PC', async () => {
    const { encounterId, pcParticipantId } = await playerFixture(db);
    const outsider = await seedUser(db, { username: 'intruder' });

    await expectHttpError(
      POST(
        makeEvent({
          user: { id: outsider, username: 'intruder', isAdmin: false, email: null, emailVerified: false },
          params: { id: encounterId, pid: pcParticipantId },
          body: PLAN_BODY
        })
      ),
      403
    );
  });

  // Permissive default (dice-roller phase 8a): a campaign member may plan for
  // a PC they don't own. Before this, only the owner could.
  it("lets a campaign member plan for a PC they don't own", async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const ownerId = await seedUser(db, { username: 'owner' });
    const otherId = await seedUser(db, { username: 'other' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [ownerId, otherId] });
    const characterId = await seedCharacter(db, { campaignId, ownerUserId: ownerId });
    const encounterId = await seedEncounter(db, { campaignId });
    const pcId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId,
      name: 'Hero'
    });

    const res = await POST(
      makeEvent({
        user: { id: otherId, username: 'other', isAdmin: false, email: null, emailVerified: false },
        params: { id: encounterId, pid: pcId },
        body: PLAN_BODY
      })
    );
    expect(res.status).toBe(200);
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
          user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
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

  // Regression: DELETE nulled plan_json outright, so anything that isn't
  // our own browser client — curl, a second client, a future server-side
  // reset — silently wiped the combat economy, the DM's NPC spell slots,
  // the condition-duration overlay and the lair marker along with the
  // plan. The preservation used to live only in the channel's clearPlan.
  it('keeps economy, slots, timers and lair when the DM DELETEs the plan', async () => {
    const { dmId, encounterId, monsterId } = await dmFixture(db);
    await db
      .update(schema.participants)
      .set({
        planJson: JSON.stringify({
          actionId: 'staff',
          actionLabel: 'Staff',
          targetParticipantIds: ['pc-1'],
          notes: 'zap them',
          updatedAt: 1,
          combat: {
            reactionUsed: true,
            legendaryUsed: 2,
            round: 3,
            spellSlots: { '3': { max: 3, used: 2 } }
          },
          conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
          lair: true
        })
      })
      .where(eq(schema.participants.id, monsterId));

    const res = await DELETE(
      makeEvent({
        user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
        params: { id: encounterId, pid: monsterId }
      })
    );
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, monsterId));
    const stored = JSON.parse(rows[0].planJson!);
    // The declared intent is gone — an empty actionId reads as "no plan".
    expect(stored.actionId).toBe('');
    expect(stored.actionLabel).toBe('');
    expect(stored.targetParticipantIds).toEqual([]);
    expect(stored.notes).toBe('');
    // Everything that merely shares the column survives.
    expect(stored.combat).toMatchObject({
      reactionUsed: true,
      legendaryUsed: 2,
      round: 3,
      spellSlots: { 3: { max: 3, used: 2 } }
    });
    expect(stored.conditionTimers).toEqual([{ condition: 'poisoned', untilRound: 9 }]);
    expect(stored.lair).toBe(true);
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
        user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
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
