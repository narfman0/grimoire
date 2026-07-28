import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedContent,
  seedEncounter,
  seedMinimumContent,
  seedParticipant,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'u') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** DM + one level-3 fighter PC (minCharDoc) linked into the encounter. */
async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'p' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  await seedMinimumContent(db);
  const encounterId = await seedEncounter(db, { campaignId, status: 'staging' });
  return { dmId, playerId, campaignId, encounterId };
}

async function addPc(db: Db, campaignId: string, encounterId: string, ownerUserId: string) {
  const charId = crypto.randomUUID();
  const id = await seedCharacter(db, {
    campaignId,
    ownerUserId,
    name: 'Hero',
    document: minCharDoc(charId), // fighter level 3
    linkToCampaign: true
  });
  await seedParticipant(db, { encounterId, kind: 'pc', characterId: id, name: 'Hero' });
  return id;
}

describe('GET /api/encounters/[id]/difficulty', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('rates a goblin against a single level-3 PC', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);
    await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.edition).toBe('2014');
    expect(body.partySize).toBe(1);
    expect(body.partyLevels).toEqual([3]);
    expect(body.monsterCount).toBe(1);
    expect(body.baseXp).toBe(50); // goblin fixture carries xp: 50
    // 1 monster is x1, but a sub-3 party steps one tier up to x1.5.
    expect(body.multiplier).toBe(1.5);
    expect(body.adjustedXp).toBe(75);
    expect(body.thresholds).toEqual({ easy: 75, medium: 150, hard: 225, deadly: 400 });
    expect(body.rating).toBe('easy');
    expect(body.unrated).toEqual([]);
  });

  it('pulls CR/XP from the pack statblock for every monster copy', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);
    for (let i = 0; i < 4; i++) {
      await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'goblin' });
    }
    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.monsterCount).toBe(4);
    expect(body.baseXp).toBe(200);
    // 4 monsters -> x2, sub-3 party -> x2.5
    expect(body.multiplier).toBe(2.5);
    expect(body.adjustedXp).toBe(500);
    expect(body.rating).toBe('deadly'); // one level-3 PC: deadly is 400
  });

  it('falls back to the CR table when the statblock has no xp field', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);
    await seedContent(db, [
      { kind: 'monster', slug: 'ogre-nox', name: 'Ogre', data: { cr: 2 } } // no xp
    ]);
    await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'ogre-nox' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.baseXp).toBe(450); // CR 2 -> 450 XP
    expect(body.unrated).toEqual([]);
  });

  it('lists monsters it cannot price in `unrated` but still counts them', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);
    await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'goblin' });
    await seedParticipant(db, { encounterId, kind: 'npc', name: 'Mystery Guest' }); // no statblock at all

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.monsterCount).toBe(2);
    expect(body.baseXp).toBe(50);
    expect(body.unrated).toEqual(['Mystery Guest']);
  });

  it('excludes PCs from the roster and characters not in the encounter from the party', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);
    // Linked to the campaign but NOT a participant — must not raise the budget.
    const strayId = crypto.randomUUID();
    await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Benchwarmer',
      document: minCharDoc(strayId),
      linkToCampaign: true
    });
    await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.partySize).toBe(1);
    expect(body.monsterCount).toBe(1);
  });

  it('returns rating=unknown when no PCs are in the encounter', async () => {
    const { dmId, encounterId } = await fixture(db);
    await seedParticipant(db, { encounterId, kind: 'monster', statblockSlug: 'goblin' });

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.partySize).toBe(0);
    expect(body.thresholds).toEqual({ easy: 0, medium: 0, hard: 0, deadly: 0 });
    expect(body.rating).toBe('unknown');
  });

  it('returns a trivial zero result for an empty roster', async () => {
    const { dmId, campaignId, encounterId } = await fixture(db);
    await addPc(db, campaignId, encounterId, dmId);

    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: encounterId } }));
    const body = await res.json();
    expect(body.monsterCount).toBe(0);
    expect(body.adjustedXp).toBe(0);
    expect(body.rating).toBe('trivial');
  });

  it('is DM only (403 for a player member)', async () => {
    const { playerId, encounterId } = await fixture(db);
    await expectHttpError(
      GET(makeEvent({ user: userOf(playerId, 'p'), params: { id: encounterId } })),
      403
    );
  });

  it('403s for a non-member and 404s for an unknown encounter', async () => {
    const { dmId, encounterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      GET(makeEvent({ user: userOf(stranger, 'stranger'), params: { id: encounterId } })),
      403
    );
    await expectHttpError(
      GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: crypto.randomUUID() } })),
      404
    );
  });
});
