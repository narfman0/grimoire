import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter
} from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET, PATCH, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

/** Minimum valid CharacterDocument shape — exercises every required field
 *  in the Zod schema. Append-only: new optional fields added to the
 *  schema get their own asserts in the dedicated tests below. */
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
    currentHp: 8,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

async function fixture(db: Db) {
  const owner = await seedUser(db, { username: 'owner' });
  const dmId = await seedUser(db, { username: 'dm' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [owner] });
  const characterId = await seedCharacter(db, {
    campaignId,
    ownerUserId: owner,
    name: 'Hero',
    document: minDoc('seed'), // id gets rewritten by PATCH path; seed is fine.
    linkToCampaign: true // access checks join through campaign_characters
  });
  return { dmId, owner, campaignId, characterId };
}

const ownerOf = (id: string) => ({ id, username: 'owner', isAdmin: false, email: null, emailVerified: false });
const userOf = (id: string, username: string, isAdmin = false) =>
  ({ id, username, isAdmin, email: null, emailVerified: false });

describe('GET /api/characters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('returns the character to a campaign member', async () => {
    const { owner, characterId } = await fixture(db);
    const res = await GET(makeEvent({ user: ownerOf(owner), params: { id: characterId } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(characterId);
    expect(body.name).toBe('Hero');
  });

  it('returns 401 without a session', async () => {
    const { characterId } = await fixture(db);
    await expectHttpError(
      GET(makeEvent({ user: null, params: { id: characterId } })),
      401
    );
  });

  it('returns 403 to a user outside the campaign', async () => {
    const { characterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      GET(
        makeEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { id: characterId }
        })
      ),
      403
    );
  });

  it('returns the character to the DM of the linked campaign', async () => {
    const { dmId, characterId } = await fixture(db);
    const res = await GET(makeEvent({ user: userOf(dmId, 'dm'), params: { id: characterId } }));
    expect(res.status).toBe(200);
  });

  it('returns 403 to a pending (unapproved) campaign member', async () => {
    const { campaignId, characterId } = await fixture(db);
    const pending = await seedUser(db, { username: 'pending' });
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: pending,
      role: 'player',
      status: 'pending',
      joinedAt: new Date()
    });
    await expectHttpError(
      GET(makeEvent({ user: userOf(pending, 'pending'), params: { id: characterId } })),
      403
    );
  });

  it('returns 404 for an unknown character', async () => {
    const { owner } = await fixture(db);
    await expectHttpError(
      GET(
        makeEvent({
          user: ownerOf(owner),
          params: { id: crypto.randomUUID() }
        })
      ),
      404
    );
  });
});

describe('PATCH /api/characters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the name-only patch path (no document field).
  it('PATCH name updates the row and returns the new name', async () => {
    const { owner, characterId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: ownerOf(owner),
        params: { id: characterId },
        body: { name: 'Renamed' }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Renamed');
  });

  // **The Zod-strip detection test.** Every documented optional field on
  // CharacterDocument should round-trip. If someone removes a field from
  // the schema, the round-trip drops it and this fails — exactly the
  // class of regression `c93b943` was.
  it('round-trips every CharacterDocument optional field', async () => {
    const { owner, characterId } = await fixture(db);
    const docIn = {
      ...minDoc(characterId),
      // Optional fields the client sets and expects back:
      alignment: 'Lawful Good',
      subspecies: { kind: 'subspecies', slug: 'hill-dwarf', version: 1, choices: {} },
      background: { kind: 'background', slug: 'sage', version: 1, choices: {} },
      currentHp: 7,
      tempHp: 3,
      hitDiceSpent: { fighter: 1 },
      conditions: ['frightened'],
      modifierToggles: { rage: true },
      resourcesSpent: { 'rage:uses': 1 },
      actionUsedThisRound: true,
      bonusActionUsedThisRound: false,
      reactionUsedThisRound: true,
      movementUsedThisRound: 15,
      concentrating: { label: 'Bless', sinceRound: 2 },
      favoriteActionIds: ['longsword']
    };
    const res = await PATCH(
      makeEvent({
        user: ownerOf(owner),
        params: { id: characterId },
        body: { document: docIn }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.document.alignment).toBe('Lawful Good');
    expect(body.document.subspecies.slug).toBe('hill-dwarf');
    expect(body.document.tempHp).toBe(3);
    expect(body.document.conditions).toEqual(['frightened']);
    expect(body.document.resourcesSpent).toEqual({ 'rage:uses': 1 });
    expect(body.document.actionUsedThisRound).toBe(true);
    expect(body.document.movementUsedThisRound).toBe(15);
    expect(body.document.concentrating).toEqual({ label: 'Bless', sinceRound: 2 });
    expect(body.document.favoriteActionIds).toEqual(['longsword']);

    // And the same survives a re-fetch (no DB-side stripping).
    const reread = await GET(makeEvent({ user: ownerOf(owner), params: { id: characterId } }));
    const reBody = await reread.json();
    expect(reBody.document.favoriteActionIds).toEqual(['longsword']);
  });

  it('rewrites document.id to match the row id (no spoofing)', async () => {
    const { owner, characterId } = await fixture(db);
    const docIn = { ...minDoc('imposter-id') };
    const res = await PATCH(
      makeEvent({
        user: ownerOf(owner),
        params: { id: characterId },
        body: { document: docIn }
      })
    );
    const body = await res.json();
    expect(body.document.id).toBe(characterId);
  });

  it('rejects a stranger (403)', async () => {
    const { characterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { id: characterId },
          body: { name: 'Pwned' }
        })
      ),
      403
    );
  });

  // The DM encounter screen applies damage to PCs by patching their document
  // — the DM of a linked campaign must keep write access.
  it('allows the DM of the linked campaign to patch a player sheet', async () => {
    const { dmId, characterId } = await fixture(db);
    const res = await PATCH(
      makeEvent({
        user: userOf(dmId, 'dm'),
        params: { id: characterId },
        body: { name: 'DM Adjusted' }
      })
    );
    expect(res.status).toBe(200);
  });

  // Regression: any co-member used to be able to overwrite any character in
  // the campaign. Player co-members are read-only.
  it('rejects a player co-member writing another player sheet (403)', async () => {
    const { campaignId, characterId } = await fixture(db);
    const rival = await seedUser(db, { username: 'rival' });
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: rival,
      role: 'player',
      status: 'approved',
      joinedAt: new Date()
    });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(rival, 'rival'),
          params: { id: characterId },
          body: { name: 'Pwned' }
        })
      ),
      403
    );
  });

  it('allows an admin to write any character', async () => {
    const { characterId } = await fixture(db);
    const admin = await seedUser(db, { username: 'admin' });
    const res = await PATCH(
      makeEvent({
        user: userOf(admin, 'admin', true),
        params: { id: characterId },
        body: { name: 'Admin Edit' }
      })
    );
    expect(res.status).toBe(200);
  });

  // Locks Zod refinement: an empty patch body is rejected.
  it('rejects an empty body (400)', async () => {
    const { owner, characterId } = await fixture(db);
    await expectHttpError(
      PATCH(
        makeEvent({
          user: ownerOf(owner),
          params: { id: characterId },
          body: {}
        })
      ),
      400
    );
  });
});

describe('DELETE /api/characters/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('deletes the row and returns 204', async () => {
    const { owner, characterId } = await fixture(db);
    const res = await DELETE(
      makeEvent({
        user: ownerOf(owner),
        params: { id: characterId },
        method: 'DELETE'
      })
    );
    expect(res.status).toBe(204);
    const rows = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId));
    expect(rows.length).toBe(0);
  });

  // Regression: any co-member used to be able to delete another player's
  // character outright. Even the DM cannot delete — only owner/admin;
  // the DM unlinks it from the campaign instead.
  it('rejects a co-member DM deleting another player character (403)', async () => {
    const { dmId, characterId } = await fixture(db);
    await expectHttpError(
      DELETE(
        makeEvent({ user: userOf(dmId, 'dm'), params: { id: characterId }, method: 'DELETE' })
      ),
      403
    );
    const rows = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId));
    expect(rows.length).toBe(1);
  });
});

// ---- Standalone characters (no campaign) ----

async function standaloneFixture(db: Db) {
  const owner = await seedUser(db, { username: 'owner' });
  const characterId = await seedCharacter(db, {
    campaignId: null,
    ownerUserId: owner,
    name: 'Standalone Hero',
    document: minDoc('seed')
  });
  return { owner, characterId };
}

describe('standalone character (no campaign)', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('GET returns the character to its owner', async () => {
    const { owner, characterId } = await standaloneFixture(db);
    const res = await GET(makeEvent({ user: ownerOf(owner), params: { id: characterId } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(characterId);
    expect(body.campaignId).toBeNull();
  });

  it('GET returns 403 to a non-owner', async () => {
    const { characterId } = await standaloneFixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      GET(makeEvent({ user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false }, params: { id: characterId } })),
      403
    );
  });

  it('PATCH updates for the owner', async () => {
    const { owner, characterId } = await standaloneFixture(db);
    const res = await PATCH(makeEvent({ user: ownerOf(owner), params: { id: characterId }, body: { name: 'Renamed' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Renamed');
  });

  it('DELETE removes the row for the owner', async () => {
    const { owner, characterId } = await standaloneFixture(db);
    const res = await DELETE(makeEvent({ user: ownerOf(owner), params: { id: characterId }, method: 'DELETE' }));
    expect(res.status).toBe(204);
    const rows = await db.select().from(schema.characters).where(eq(schema.characters.id, characterId));
    expect(rows.length).toBe(0);
  });
});
