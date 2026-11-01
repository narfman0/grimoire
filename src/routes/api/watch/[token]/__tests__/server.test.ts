import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedEncounter,
  seedParticipant,
  seedActionLog,
  seedMinimumContent,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';
import { GET as SPECTATOR_GET, POST as SPECTATOR_POST, DELETE as SPECTATOR_DELETE } from '../../../campaigns/[code]/spectator/+server';
import { PATCH as CAMPAIGN_PATCH } from '../../../campaigns/[code]/+server';
import { GET as DASHBOARD_GET } from '../../../campaigns/[code]/dashboard/+server';
import { PartyDashboardResponse } from '$lib/server/api/schemas';

type Db = ReturnType<typeof setupTestDb>;

const CODE = 'WATCHR';

function asUser(id: string, username = 'user') {
  return { id, username, isAdmin: false, email: null, emailVerified: false };
}

async function fixture(db: Db) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId], code: CODE });
  const heroId = await seedCharacter(db, {
    campaignId,
    ownerUserId: playerId,
    name: 'Hero',
    linkToCampaign: true,
    document: {
      ...minCharDoc('hero'),
      currentHp: 20,
      tempHp: 3,
      conditions: ['poisoned'],
      concentrating: { label: 'Bless' }
    }
  });
  return { dmId, playerId, campaignId, heroId };
}

async function issueToken(dmId: string): Promise<string> {
  const res = await SPECTATOR_POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE } }));
  return ((await res.json()) as { token: string }).token;
}

async function watch(token: string) {
  const res = await GET(makeEvent({ params: { token } }));
  expect(res.status).toBe(200);
  return PartyDashboardResponse.parse(await res.json());
}

describe('spectator link management', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('is DM-only', async () => {
    const { playerId } = await fixture(db);
    await expectHttpError(
      SPECTATOR_POST(makeEvent({ user: asUser(playerId, 'player'), params: { code: CODE } })),
      403
    );
    await expectHttpError(
      SPECTATOR_GET(makeEvent({ user: asUser(playerId, 'player'), params: { code: CODE } })),
      403
    );
    await expectHttpError(SPECTATOR_GET(makeEvent({ user: null, params: { code: CODE } })), 401);
  });

  it('issues, reads, regenerates and revokes', async () => {
    const { dmId } = await fixture(db);
    const dm = asUser(dmId, 'dm');
    const empty = await SPECTATOR_GET(makeEvent({ user: dm, params: { code: CODE } }));
    expect(await empty.json()).toEqual({ token: null });

    const first = await issueToken(dmId);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    const read = await SPECTATOR_GET(makeEvent({ user: dm, params: { code: CODE } }));
    expect(await read.json()).toEqual({ token: first });
    await watch(first);

    // Regenerate: the old link dies.
    const second = await issueToken(dmId);
    expect(second).not.toBe(first);
    await expectHttpError(GET(makeEvent({ params: { token: first } })), 404);
    await watch(second);

    // Revoke: the current link dies too.
    const del = await SPECTATOR_DELETE(makeEvent({ user: dm, params: { code: CODE }, method: 'DELETE' }));
    expect(del.status).toBe(204);
    await expectHttpError(GET(makeEvent({ params: { token: second } })), 404);
  });

  it('keeps the link when the DM changes a table permission', async () => {
    // Regression guard: the campaign PATCH rewrites permissions_json from the
    // resolved permissions object, which used to drop every other key.
    const { dmId } = await fixture(db);
    const token = await issueToken(dmId);
    const res = await CAMPAIGN_PATCH(
      makeEvent({
        user: asUser(dmId, 'dm'),
        params: { code: CODE },
        method: 'PATCH',
        body: { permissions: { actForOthers: false } }
      })
    );
    expect(res.status).toBe(200);
    await watch(token);
  });

  it('rejects malformed and unknown tokens without leaking anything', async () => {
    await fixture(db);
    await expectHttpError(GET(makeEvent({ params: { token: 'not-a-token' } })), 400);
    await expectHttpError(GET(makeEvent({ params: { token: 'a'.repeat(32) } })), 404);
  });
});

describe('GET /api/watch/[token] — player lens', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('shows the party with derived stats and doc vitals', async () => {
    const { dmId } = await fixture(db);
    const body = await watch(await issueToken(dmId));
    expect(body.campaign.name).toBe('Test Campaign');
    expect(body.party).toHaveLength(1);
    const hero = body.party[0];
    expect(hero.name).toBe('Hero');
    expect(hero.hasSheet).toBe(true);
    expect(hero.currentHp).toBe(20);
    expect(hero.tempHp).toBe(3);
    expect(hero.maxHp).toBeGreaterThan(0);
    expect(hero.ac).toBeGreaterThan(0);
    expect(hero.conditions).toEqual(['poisoned']);
    expect(hero.concentrating).toBe('Bless');
    expect(hero.classLine).toBe('Fighter 3');
    expect(body.encounter).toBeNull();
  });

  it('redacts the encounter strip exactly like a player view', async () => {
    const { dmId, campaignId, heroId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live', name: 'Bridge' });
    const pc = await seedParticipant(db, {
      encounterId,
      kind: 'pc',
      characterId: heroId,
      name: 'Hero',
      initiative: 15
    });
    const goblin = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Goblin Boss',
      initiative: 12,
      currentHp: 4,
      maxHp: 20
    });
    const revealed = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Wolf',
      initiative: 10,
      currentHp: 11,
      maxHp: 11,
      reveals: { identity: true, vitals: true }
    });
    const ambusher = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Hidden Assassin',
      initiative: 20,
      reveals: { hidden: true }
    });
    // The hidden creature is on its turn — the strip must not point at it.
    await db
      .update(schema.encounters)
      .set({ round: 2, activeParticipantId: ambusher })
      .where(eq(schema.encounters.id, encounterId));

    const body = await watch(await issueToken(dmId));
    const enc = body.encounter!;
    expect(enc.name).toBe('Bridge');
    expect(enc.round).toBe(2);
    expect(enc.activeParticipantId).toBeNull();
    expect(enc.combatants.map((c) => c.id)).toEqual([pc, goblin, revealed]);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('Hidden Assassin');
    expect(raw).not.toContain(ambusher);
    expect(raw).not.toContain('Goblin Boss');

    const [hero, gob, wolf] = enc.combatants;
    expect(hero.name).toBe('Hero');
    expect(hero.currentHp).toBe(20);
    expect(gob.name).toBe('Enemy 1');
    expect(gob.currentHp).toBeNull();
    expect(gob.maxHp).toBeNull();
    expect(gob.hpBucket).toBe('critical');
    expect(wolf.name).toBe('Wolf');
    expect(wolf.currentHp).toBe(11);
    expect(wolf.maxHp).toBe(11);
  });

  it('redacts the log: hidden actors neutralized, unrevealed names and HP withheld', async () => {
    const { dmId, campaignId, heroId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    const pc = await seedParticipant(db, { encounterId, kind: 'pc', characterId: heroId, name: 'Hero' });
    const goblin = await seedParticipant(db, { encounterId, kind: 'monster', name: 'Goblin Boss' });
    const ambusher = await seedParticipant(db, {
      encounterId,
      kind: 'monster',
      name: 'Hidden Assassin',
      reveals: { hidden: true }
    });
    await seedActionLog(db, {
      encounterId,
      submittedByUserId: dmId,
      participantId: ambusher,
      targetParticipantId: pc,
      actionLabel: 'Poisoned Dagger',
      damageRoll: 9,
      targetHpBefore: 29,
      targetHpAfter: 20
    });
    await seedActionLog(db, {
      encounterId,
      submittedByUserId: dmId,
      participantId: pc,
      targetParticipantId: goblin,
      actionLabel: 'Longsword',
      hit: 'hit',
      damageRoll: 7,
      targetHpBefore: 11,
      targetHpAfter: 4
    });

    const body = await watch(await issueToken(dmId));
    const raw = JSON.stringify(body.log);
    expect(raw).not.toContain('Hidden Assassin');
    expect(raw).not.toContain('Poisoned Dagger');
    expect(raw).not.toContain('Goblin Boss');
    const sword = body.log.find((e) => e.summary.includes('Longsword'))!;
    expect(sword.summary).toBe('Hero: Longsword → Enemy 1 (hit, 7 dmg)');
    expect(sword.hpBefore).toBeNull();
    expect(sword.hpAfter).toBeNull();
    expect(sword.characterIds).toEqual([heroId]);
    const hidden = body.log.find((e) => e.id !== sword.id)!;
    expect(hidden.redacted).toBe(true);
    expect(hidden.summary).toContain('Something happens');
  });

  it('never shows staging encounters', async () => {
    const { dmId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'staging', name: 'Dragon lair prep' });
    await seedParticipant(db, { encounterId, kind: 'monster', name: 'Ancient Dragon' });
    const body = await watch(await issueToken(dmId));
    expect(body.encounter).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Dragon');
  });

  it('answers 304 when the ETag still matches', async () => {
    const { dmId } = await fixture(db);
    const token = await issueToken(dmId);
    const first = await GET(makeEvent({ params: { token } }));
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const event = makeEvent({ params: { token } });
    event.request.headers.set('if-none-match', etag);
    const second = await GET(event);
    expect(second.status).toBe(304);
  });
});

describe('GET /api/campaigns/[code]/dashboard', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('serves members the same player-lens payload, even the DM', async () => {
    const { dmId, playerId, campaignId } = await fixture(db);
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    await seedParticipant(db, { encounterId, kind: 'monster', name: 'Hidden Assassin', reveals: { hidden: true } });
    for (const user of [asUser(dmId, 'dm'), asUser(playerId, 'player')]) {
      const res = await DASHBOARD_GET(makeEvent({ user, params: { code: CODE } }));
      expect(res.status).toBe(200);
      const body = PartyDashboardResponse.parse(await res.json());
      expect(JSON.stringify(body)).not.toContain('Hidden Assassin');
      expect(body.party).toHaveLength(1);
    }
  });

  it('rejects non-members', async () => {
    await fixture(db);
    const strangerId = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      DASHBOARD_GET(makeEvent({ user: asUser(strangerId, 'stranger'), params: { code: CODE } })),
      403
    );
  });
});
