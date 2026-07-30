import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant
} from '$lib/server/__tests__/fixtures';
import { makeEvent } from '$lib/server/__tests__/test-event';
import { PATCH } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

const planWithMove = (moveTo: { x: number; y: number }) =>
  JSON.stringify({
    actionId: 'bite',
    actionLabel: 'Bite',
    targetParticipantIds: [],
    notes: '',
    updatedAt: 1,
    moveTo,
    path: [moveTo]
  });

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId } = await seedCampaign(db, { dmId });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  const goblinId = await seedParticipant(db, {
    encounterId,
    kind: 'monster',
    name: 'Goblin',
    posX: 0,
    posY: 0,
    planJson: planWithMove({ x: 3, y: 2 })
  });
  const heroId = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Next Up' });
  await db
    .update(schema.encounters)
    .set({ activeParticipantId: goblinId, round: 2 })
    .where(eq(schema.encounters.id, encounterId));
  return { dm: userOf(dmId, 'dm'), encounterId, goblinId, heroId };
}

async function advance(db: Db, dm: ReturnType<typeof userOf>, encounterId: string, to: string) {
  const res = await PATCH(
    makeEvent({
      user: dm,
      params: { id: encounterId },
      body: { activeParticipantId: to },
      method: 'PATCH'
    })
  );
  expect(res.status).toBe(200);
}

async function participant(db: Db, id: string) {
  const rows = await db.select().from(schema.participants).where(eq(schema.participants.id, id));
  return rows[0];
}

describe('turn advance applies the planned move server-side', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('moves the token, logs the move, and strips it from the plan', async () => {
    const { dm, encounterId, goblinId, heroId } = await fixture(db);
    await advance(db, dm, encounterId, heroId);

    const gob = await participant(db, goblinId);
    expect([gob.posX, gob.posY]).toEqual([3, 2]);
    const plan = JSON.parse(gob.planJson!);
    expect(plan.moveTo).toBeUndefined();
    expect(plan.path).toBeUndefined();
    expect(plan.actionId).toBe('bite'); // the intent survives

    const log = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      participantId: goblinId,
      actionId: 'move',
      actionLabel: '➜ moved to (3, 2)',
      round: 2
    });

    // A second advance in the other direction must not re-apply or re-log.
    await advance(db, dm, encounterId, goblinId);
    await advance(db, dm, encounterId, heroId);
    const logAfter = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(logAfter).toHaveLength(1);
  });

  it('refuses an out-of-bounds move but still strips it', async () => {
    const { dm, encounterId, goblinId, heroId } = await fixture(db);
    await db.insert(schema.encounterBoards).values({
      encounterId,
      w: 2,
      h: 2,
      cellFt: 5,
      tilesJson: '1x4',
      revealedJson: '0x4',
      version: 1,
      updatedAt: new Date()
    });
    await advance(db, dm, encounterId, heroId);

    const gob = await participant(db, goblinId);
    expect([gob.posX, gob.posY]).toEqual([0, 0]); // unmoved — (3,2) is off a 2×2 board
    expect(JSON.parse(gob.planJson!).moveTo).toBeUndefined();
    const log = await db
      .select()
      .from(schema.actionLog)
      .where(eq(schema.actionLog.encounterId, encounterId));
    expect(log).toHaveLength(0);
  });

  it('does nothing when the departing participant has no planned move', async () => {
    const { dm, encounterId, heroId, goblinId } = await fixture(db);
    await db
      .update(schema.participants)
      .set({ planJson: null })
      .where(eq(schema.participants.id, goblinId));
    await advance(db, dm, encounterId, heroId);
    const gob = await participant(db, goblinId);
    expect([gob.posX, gob.posY]).toEqual([0, 0]);
  });
});
