import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser, seedCampaign, seedCharacter } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET, POST } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

function minDoc(id: string) {
  return {
    id,
    name: 'Hero',
    classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
    species: { kind: 'species', slug: 'human', version: 1, choices: {} },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficienciesChosen: {},
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

const userOf = (id: string, username: string) =>
  ({ id, username, isAdmin: false, email: null, emailVerified: false });

describe('GET /api/characters', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  async function listFixture(db: Db) {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId, code } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    const characterId = await seedCharacter(db, {
      campaignId,
      ownerUserId: playerId,
      name: 'Hero',
      linkToCampaign: true
    });
    return { dmId, playerId, campaignId, code, characterId };
  }

  it('lists campaign characters through the campaign_characters join', async () => {
    const { dmId, characterId } = await listFixture(db);
    const res = await GET(makeEvent({ user: userOf(dmId, 'dm') }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.characters.map((c: { id: string }) => c.id)).toContain(characterId);
  });

  it('includes the user own standalone characters', async () => {
    const playerId = await seedUser(db, { username: 'solo' });
    const characterId = await seedCharacter(db, {
      campaignId: null,
      ownerUserId: playerId,
      name: 'Loner'
    });
    const res = await GET(makeEvent({ user: userOf(playerId, 'solo') }));
    const body = await res.json();
    expect(body.characters.map((c: { id: string }) => c.id)).toContain(characterId);
  });

  // Regression: a merely-pending member used to see every character in the
  // campaign (the membership query lacked the approved-status filter).
  it('shows nothing to a pending (unapproved) member', async () => {
    const { campaignId, characterId } = await listFixture(db);
    const pending = await seedUser(db, { username: 'pending' });
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: pending,
      role: 'player',
      status: 'pending',
      joinedAt: new Date()
    });
    const res = await GET(makeEvent({ user: userOf(pending, 'pending') }));
    const body = await res.json();
    expect(body.characters.map((c: { id: string }) => c.id)).not.toContain(characterId);
    expect(body.characters).toEqual([]);
  });

  it('rejects the ?campaign filter for a non-member (403)', async () => {
    const { code } = await listFixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      GET(makeEvent({ user: userOf(stranger, 'stranger'), searchParams: { campaign: code } })),
      403
    );
  });
});

describe('POST /api/characters — standalone (no campaignCode)', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('creates a character with null campaignId when no campaignCode is given', async () => {
    const userId = await seedUser(db, { username: 'player' });
    const res = await POST(
      makeEvent({
        user: { id: userId, username: 'player', isAdmin: false, email: null, emailVerified: false },
        body: { name: 'Solo Hero', document: minDoc('placeholder') }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Solo Hero');
    expect(body.campaignId).toBeNull();

    const rows = await db.select().from(schema.characters).where(eq(schema.characters.id, body.id));
    expect(rows.length).toBe(1);
    expect(rows[0].campaignId).toBeNull();

    // Should NOT create a campaign_characters row
    const links = await db
      .select()
      .from(schema.campaignCharacters)
      .where(eq(schema.campaignCharacters.characterId, body.id));
    expect(links.length).toBe(0);
  });

  it('returns 401 without a session', async () => {
    await expectHttpError(
      POST(makeEvent({ user: null, body: { name: 'Solo Hero' } })),
      401
    );
  });

  it('creates a campaign-linked character when campaignCode is provided', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'player' });
    const { code } = await seedCampaign(db, { dmId, playerIds: [playerId] });

    const res = await POST(
      makeEvent({
        user: { id: playerId, username: 'player', isAdmin: false, email: null, emailVerified: false },
        body: { name: 'Campaign Hero', campaignCode: code, document: minDoc('placeholder') }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaignId).not.toBeNull();

    const links = await db
      .select()
      .from(schema.campaignCharacters)
      .where(eq(schema.campaignCharacters.characterId, body.id));
    expect(links.length).toBe(1);
  });
});
