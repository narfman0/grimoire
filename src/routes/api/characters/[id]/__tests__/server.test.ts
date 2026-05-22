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
    document: minDoc('seed') // id gets rewritten by PATCH path; seed is fine.
  });
  return { dmId, owner, campaignId, characterId };
}

const ownerOf = (id: string) => ({ id, username: 'owner', isAdmin: false, email: null, emailVerified: false });

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
