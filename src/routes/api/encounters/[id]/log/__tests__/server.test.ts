// Integration test for the action-log POST handler. Verifies the
// trigger consumer wiring (engine gap #2): when a log row commits with
// targetHpAfter === 0 on a PC participant whose character document
// references a feat with a `damage.reduce-to-zero` trigger, the
// response surfaces the matched trigger opportunity.

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedCharacter,
  seedContent,
  seedActionLog
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET, POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name = 'u') => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

/** Build a minimal PC document referencing a `half-orc` species that has
 *  a Relentless Endurance trigger. We hang the trigger directly off the
 *  species fixture so we don't have to mint a class / background as
 *  well. */
function relentlessHalfOrcDoc(id: string) {
  return {
    id,
    name: 'Bharash',
    classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
    species: { kind: 'species', slug: 'half-orc-test', version: 1, choices: {} },
    background: { kind: 'background', slug: 'soldier', version: 1, choices: {} },
    feats: [],
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 8 },
    proficienciesChosen: { skills: [], tools: [], languages: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 12,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

async function seedRelentlessContent(db: Db): Promise<void> {
  await seedContent(db, [
    {
      kind: 'species',
      slug: 'half-orc-test',
      name: 'Half-Orc (test)',
      data: {
        size: 'medium',
        speed: { walk: 30 },
        languages: ['common'],
        // Author the trigger directly on the species's `data.triggers`
        // — derive() walks `data.triggers[]` on every active content row.
        triggers: [
          {
            kind: 'trigger',
            id: 'relentless-endurance',
            name: 'Relentless Endurance',
            on: ['damage.reduce-to-zero'],
            scope: { predicates: [{ self: true }] },
            grants: { type: 'set-hp', value: 1 },
            limit: { per: 'long-rest', uses: 1 }
          }
        ]
      }
    },
    {
      kind: 'class',
      slug: 'fighter',
      name: 'Fighter',
      data: {
        hitDie: 10,
        primaryAbility: ['str', 'dex'],
        saves: ['str', 'con'],
        armorProficiencies: ['light', 'medium', 'heavy', 'shield'],
        weaponProficiencies: ['simple', 'martial'],
        skillChoices: { from: ['athletics', 'intimidation'], pick: 2 },
        spellcasting: null,
        features: []
      }
    },
    {
      kind: 'background',
      slug: 'soldier',
      name: 'Soldier',
      data: { skillProficiencies: ['athletics', 'intimidation'] }
    }
  ]);
}

describe('POST /api/encounters/[id]/log — trigger consumer wiring', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('surfaces a damage.reduce-to-zero opportunity for Relentless Endurance', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    await seedRelentlessContent(db);
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: playerId,
      document: relentlessHalfOrcDoc('char-1'),
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcParticipantId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Bharash'
    });
    const mobParticipantId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin'
    });

    // DM logs the killing blow: the goblin reduces Bharash to 0.
    const res = await POST(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: {
          participantId: mobParticipantId,
          targetParticipantId: pcParticipantId,
          actionId: 'attack:scimitar',
          actionLabel: 'Scimitar',
          round: 1,
          attackRoll: 18,
          damageRoll: 14,
          hit: 'hit',
          targetHpBefore: 12,
          targetHpAfter: 0
        }
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.triggerOpportunities).toBeDefined();
    const opp = body.triggerOpportunities.find(
      (o: { triggerId: string }) => o.triggerId === 'relentless-endurance'
    );
    expect(opp).toBeDefined();
    expect(opp.participantId).toBe(pcParticipantId);
    expect(opp.eventName).toBe('damage.reduce-to-zero');
    expect(opp.triggerName).toBe('Relentless Endurance');
    expect(opp.limit).toEqual({ per: 'long-rest', uses: 1 });

    // The row itself was persisted.
    const allRows = await db.select().from(schema.actionLog);
    expect(allRows.length).toBe(1);
    expect(allRows[0].targetHpAfter).toBe(0);
  });

  it('returns an empty triggerOpportunities array when nothing matches', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    await seedRelentlessContent(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const mob1 = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin A'
    });
    const mob2 = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin B'
    });

    // Mob-vs-mob — no PC participants, so no derived triggers to match.
    const res = await POST(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: {
          participantId: mob1,
          targetParticipantId: mob2,
          actionId: 'attack:scimitar',
          actionLabel: 'Scimitar',
          round: 1,
          attackRoll: 12,
          damageRoll: 5,
          hit: 'hit',
          targetHpBefore: 10,
          targetHpAfter: 5
        }
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.triggerOpportunities).toEqual([]);
  });

  it('does NOT fire damage.reduce-to-zero when the target was already at 0 HP', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    await seedRelentlessContent(db);
    const charId = await seedCharacter(db, {
      campaignId,
      ownerUserId: playerId,
      document: relentlessHalfOrcDoc('char-1'),
      linkToCampaign: true
    });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pcParticipantId = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: charId,
      name: 'Bharash'
    });
    const mobParticipantId = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin'
    });

    const res = await POST(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: encounterId },
        body: {
          participantId: mobParticipantId,
          targetParticipantId: pcParticipantId,
          actionId: 'attack:scimitar',
          actionLabel: 'Scimitar',
          round: 1,
          attackRoll: 18,
          damageRoll: 4,
          hit: 'hit',
          targetHpBefore: 0,
          targetHpAfter: 0
        }
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    const reduceOpp = body.triggerOpportunities.find(
      (o: { eventName: string }) => o.eventName === 'damage.reduce-to-zero'
    );
    expect(reduceOpp).toBeUndefined();
  });
});

describe('GET /api/encounters/[id]/log — pagination', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  /** Seed `n` rows with strictly increasing createdAt so chronological
   *  order (and therefore offset slicing) is deterministic. */
  async function seedRows(encounterId: string, userId: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    const base = Date.now();
    for (let i = 0; i < n; i++) {
      const id = await seedActionLog(db, {
        encounterId,
        submittedByUserId: userId,
        actionLabel: `Action ${i}`
      });
      await db
        .update(schema.actionLog)
        .set({ createdAt: new Date(base + i * 1000) })
        .where(eq(schema.actionLog.id, id));
      ids.push(id);
    }
    return ids;
  }

  it('default request returns all rows (up to 200) with the pagination envelope', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const ids = await seedRows(encounterId, dmId, 3);

    const res = await GET(
      makeEvent({ user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false }, params: { id: encounterId } })
    );
    const body = await res.json();
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual(ids); // chronological
    expect(body.total).toBe(3);
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
  });

  it('limit + offset slice the chronological window; total reports the full count', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const ids = await seedRows(encounterId, dmId, 5);
    const user = { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false };

    const page1 = await (
      await GET(makeEvent({ user, params: { id: encounterId }, searchParams: { limit: '2' } }))
    ).json();
    expect(page1.entries.map((e: { id: string }) => e.id)).toEqual(ids.slice(0, 2));
    expect(page1.total).toBe(5);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const page3 = await (
      await GET(
        makeEvent({ user, params: { id: encounterId }, searchParams: { limit: '2', offset: '4' } })
      )
    ).json();
    expect(page3.entries.map((e: { id: string }) => e.id)).toEqual(ids.slice(4));
    expect(page3.offset).toBe(4);
  });

  it('rejects a limit above the 500 cap with a 400', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const user = { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false };
    await expectHttpError(
      GET(makeEvent({ user, params: { id: encounterId }, searchParams: { limit: '501' } })),
      400
    );
  });
});
