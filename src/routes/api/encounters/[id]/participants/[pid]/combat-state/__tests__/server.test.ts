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
import { PATCH } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const dmOf = (id: string) => ({
  id,
  username: 'dm',
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId } = await seedCampaign(db, { dmId });
  const encounterId = await seedEncounter(db, { campaignId });
  const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });
  return { dmId, campaignId, encounterId, monsterId };
}

const stored = async (db: Db, pid: string) => {
  const rows = await db.select().from(schema.participants).where(eq(schema.participants.id, pid));
  return rows[0].combatStateJson ? JSON.parse(rows[0].combatStateJson) : null;
};

describe('PATCH /api/encounters/[id]/participants/[pid]/combat-state', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('writes a slot', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: dmOf(dmId),
        params: { id: encounterId, pid: monsterId },
        body: { lair: true }
      })
    );
    expect(res.status).toBe(200);
    expect(await stored(db, monsterId)).toEqual({ lair: true });
  });

  // PATCH not POST: four independent writers share this column, and a
  // replace would let whichever landed last win over slots it never read.
  it('merges rather than replaces', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const ev = (body: unknown) =>
      makeEvent({ user: dmOf(dmId), params: { id: encounterId, pid: monsterId }, body });

    await PATCH(ev({ lair: true }));
    await PATCH(ev({ combat: { reactionUsed: true } }));
    await PATCH(ev({ conditionTimers: [{ condition: 'poisoned', untilRound: 3 }] }));

    const out = await stored(db, monsterId);
    expect(out.lair).toBe(true);
    expect(out.combat).toEqual({ reactionUsed: true });
    expect(out.conditionTimers).toEqual([{ condition: 'poisoned', untilRound: 3 }]);
  });

  it('clears a slot with null and leaves the rest', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const ev = (body: unknown) =>
      makeEvent({ user: dmOf(dmId), params: { id: encounterId, pid: monsterId }, body });
    await PATCH(ev({ lair: true, combat: { reactionUsed: true } }));
    await PATCH(ev({ lair: null }));

    const out = await stored(db, monsterId);
    expect(out.lair).toBeUndefined();
    expect(out.combat).toEqual({ reactionUsed: true });
  });

  it('drops the column entirely once nothing is left', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    const ev = (body: unknown) =>
      makeEvent({ user: dmOf(dmId), params: { id: encounterId, pid: monsterId }, body });
    await PATCH(ev({ lair: true }));
    await PATCH(ev({ lair: null }));
    expect(await stored(db, monsterId)).toBeNull();
  });

  // Migration path: state still sitting in plan_json is read forward on the
  // first write, so a fight live at deploy doesn't lose its counters.
  it('carries legacy plan_json state forward on first write', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    await db
      .update(schema.participants)
      .set({
        planJson: JSON.stringify({
          actionId: 'bite',
          combat: { legendaryUsed: 2, round: 3 },
          lair: true
        })
      })
      .where(eq(schema.participants.id, monsterId));

    await PATCH(
      makeEvent({
        user: dmOf(dmId),
        params: { id: encounterId, pid: monsterId },
        body: { conditionTimers: [{ condition: 'prone', untilRound: 1 }] }
      })
    );

    const out = await stored(db, monsterId);
    expect(out.combat).toEqual({ legendaryUsed: 2, round: 3 });
    expect(out.lair).toBe(true);
    expect(out.conditionTimers).toEqual([{ condition: 'prone', untilRound: 1 }]);
  });

  it('rejects PC participants — their state lives on the character document', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const characterId = await seedCharacter(db, { campaignId, ownerUserId: playerId });
    const encounterId = await seedEncounter(db, { campaignId });
    const pcId = await seedParticipant(db, { encounterId, kind: 'pc', characterId });

    await expectHttpError(
      PATCH(
        makeEvent({ user: dmOf(dmId), params: { id: encounterId, pid: pcId }, body: { lair: true } })
      ),
      400
    );
  });

  it('rejects a non-member', async () => {
    const { encounterId, monsterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { id: encounterId, pid: monsterId },
          body: { lair: true }
        })
      ),
      403
    );
  });

  it('rejects a player — non-PC rows are DM-only whatever the campaign policy', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const encounterId = await seedEncounter(db, { campaignId });
    const monsterId = await seedParticipant(db, { encounterId, kind: 'monster' });

    await expectHttpError(
      PATCH(
        makeEvent({
          user: { id: playerId, username: 'p', isAdmin: false, email: null, emailVerified: false },
          params: { id: encounterId, pid: monsterId },
          body: { lair: true }
        })
      ),
      403
    );
  });

  // The shape here has to match ConditionTimerJson exactly. A mismatched
  // field name 400s the write while the client's optimistic update still
  // renders the chip, so the DM sees a duration the server never stored —
  // which is precisely how this shipped broken the first time.
  it('rejects a condition timer with the wrong shape', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: dmOf(dmId),
          params: { id: encounterId, pid: monsterId },
          body: { conditionTimers: [{ condition: 'poisoned', rounds: 3 }] }
        })
      ),
      400
    );
  });

  it('rejects an empty body', async () => {
    const { dmId, encounterId, monsterId } = await fixture(db);
    await expectHttpError(
      PATCH(makeEvent({ user: dmOf(dmId), params: { id: encounterId, pid: monsterId }, body: {} })),
      400
    );
  });
});
