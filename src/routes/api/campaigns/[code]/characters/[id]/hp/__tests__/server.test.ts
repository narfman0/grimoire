import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedEncounter,
  seedParticipant,
  seedMinimumContent,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { POST } from '../+server';
import { POST as PARTICIPANT_HP } from '../../../../../../encounters/[id]/participants/[pid]/hp/+server';

type Db = ReturnType<typeof setupTestDb>;
const CODE = 'TABLEV';
const asUser = (id: string, username = 'u') => ({
  id,
  username,
  isAdmin: false,
  email: null,
  emailVerified: false
});

// minCharDoc: fighter 3, hpRolledPerLevel [10, 6, 5], CON 14 → max 27.
const MAX_HP = 27;

async function fixture(db: Db, doc: Record<string, unknown> = {}) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId], code: CODE });
  const heroId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    linkToCampaign: true,
    document: { ...minCharDoc('hero'), ...doc }
  });
  return { dmId, playerId, campaignId, heroId };
}

async function docOf(db: Db, id: string) {
  const [row] = await db
    .select({ document: schema.characters.document })
    .from(schema.characters)
    .where(eq(schema.characters.id, id));
  return JSON.parse(row.document as string);
}

describe('POST /api/campaigns/[code]/characters/[id]/hp', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('applies damage to temp HP first, then current HP', async () => {
    const { dmId, heroId } = await fixture(db, { currentHp: 20, tempHp: 5 });
    const res = await POST(
      makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { damage: 8 } })
    );
    expect(await res.json()).toEqual({ currentHp: 17, tempHp: 0 });
    const doc = await docOf(db, heroId);
    expect(doc.currentHp).toBe(17);
    expect(doc.tempHp).toBe(0);
    // The scoped writer copies the rest of the document through.
    expect(doc.classes[0].slug).toBe('fighter');
  });

  it('never drops below 0 and caps healing at derived max HP', async () => {
    const { dmId, heroId } = await fixture(db, { currentHp: 3 });
    await POST(makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { damage: 50 } }));
    expect((await docOf(db, heroId)).currentHp).toBe(0);
    const res = await POST(
      makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { heal: 500 } })
    );
    expect((await res.json()).currentHp).toBe(MAX_HP);
  });

  it('clears death saves when healed above 0', async () => {
    const { dmId, heroId } = await fixture(db, {
      currentHp: 0,
      deathSaves: { successes: 1, failures: 2 }
    });
    await POST(makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { heal: 4 } }));
    const doc = await docOf(db, heroId);
    expect(doc.currentHp).toBe(4);
    expect(doc.deathSaves).toBeUndefined();
  });

  it('routes damage through an active polymorph form', async () => {
    const { dmId, heroId } = await fixture(db, {
      currentHp: 20,
      tempHp: 0,
      polymorphForm: {
        slug: 'wolf',
        sourceContent: { kind: 'monster', slug: 'wolf' },
        currentHp: 5,
        maxHp: 11
      }
    });
    await POST(makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body: { damage: 8 } }));
    const doc = await docOf(db, heroId);
    expect(doc.polymorphForm.currentHp).toBe(0);
    expect(doc.currentHp).toBe(17);
  });

  it('is DM-only and requires the character to be in the campaign', async () => {
    const { dmId, playerId, heroId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: asUser(playerId), params: { code: CODE, id: heroId }, body: { damage: 1 } })),
      403
    );
    const strayId = await seedCharacter(db, { ownerUserId: playerId, document: minCharDoc('stray') });
    await expectHttpError(
      POST(makeEvent({ user: asUser(dmId), params: { code: CODE, id: strayId }, body: { damage: 1 } })),
      404
    );
  });

  it('requires exactly one of damage / heal', async () => {
    const { dmId, heroId } = await fixture(db);
    for (const body of [{}, { damage: 1, heal: 1 }, { damage: 0 }]) {
      await expectHttpError(
        POST(makeEvent({ user: asUser(dmId), params: { code: CODE, id: heroId }, body })),
        400
      );
    }
  });
});

describe('POST /api/encounters/[id]/participants/[pid]/hp — damage / heal', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('computes a monster delta server-side: temp first, heal capped at max', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const gob = await seedParticipant(db, { encounterId, kind: 'monster', currentHp: 7, maxHp: 7 });
    await db.update(schema.participants).set({ tempHp: 2 }).where(eq(schema.participants.id, gob));

    await PARTICIPANT_HP(
      makeEvent({ user: asUser(dmId), params: { id: encounterId, pid: gob }, body: { damage: 4 } })
    );
    let [row] = await db.select().from(schema.participants).where(eq(schema.participants.id, gob));
    expect([row.currentHp, row.tempHp]).toEqual([5, 0]);

    await PARTICIPANT_HP(
      makeEvent({ user: asUser(dmId), params: { id: encounterId, pid: gob }, body: { heal: 10 } })
    );
    [row] = await db.select().from(schema.participants).where(eq(schema.participants.id, gob));
    expect(row.currentHp).toBe(7);
  });

  it('routes a PC delta to the character document', async () => {
    const { dmId, campaignId, heroId } = await fixture(db, { currentHp: 10 });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pc = await seedParticipant(db, { encounterId, kind: 'pc', characterId: heroId });
    const res = await PARTICIPANT_HP(
      makeEvent({ user: asUser(dmId), params: { id: encounterId, pid: pc }, body: { heal: 100 } })
    );
    expect((await res.json()).currentHp).toBe(MAX_HP);
    expect((await docOf(db, heroId)).currentHp).toBe(MAX_HP);
  });

  it('rejects a delta combined with absolute fields', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const gob = await seedParticipant(db, { encounterId, kind: 'monster' });
    await expectHttpError(
      PARTICIPANT_HP(
        makeEvent({
          user: asUser(dmId),
          params: { id: encounterId, pid: gob },
          body: { damage: 3, currentHp: 1 }
        })
      ),
      400
    );
  });

  it('still forbids players from touching monsters', async () => {
    const { playerId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const gob = await seedParticipant(db, { encounterId, kind: 'monster' });
    await expectHttpError(
      PARTICIPANT_HP(
        makeEvent({ user: asUser(playerId), params: { id: encounterId, pid: gob }, body: { damage: 3 } })
      ),
      403
    );
  });
});
