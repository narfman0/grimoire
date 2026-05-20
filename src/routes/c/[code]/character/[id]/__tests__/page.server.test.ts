import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedMinimumContent,
  minCharDoc
} from '$lib/server/__tests__/fixtures';
import {
  makeLoadEvent,
  runLoad,
  expectHttpError
} from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const loadEvent = makeLoadEvent;

async function fixture(db: Db) {
  await seedMinimumContent(db);
  const dmId = await seedUser(db, { username: 'dm' });
  const owner = await seedUser(db, { username: 'owner' });
  const { campaignId, code } = await seedCampaign(db, {
    dmId,
    playerIds: [owner]
  });
  const characterId = await seedCharacter(db, {
    campaignId,
    ownerUserId: owner,
    name: 'Hero',
    document: minCharDoc('hero-1'),
    linkToCampaign: true
  });
  return { dmId, owner, code, campaignId, characterId };
}

describe('/c/[code]/character/[id] +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the full return shape — every key the +page.svelte template
  // reads. The character sheet is the highest-touch surface; a regression
  // here can blank the entire page.
  const REQUIRED_KEYS = [
    'campaign',
    'user',
    'role',
    'character',
    'document',
    'derived',
    'contentMap',
    'itemOptions',
    'spellOptions',
    'subclassOptions',
    'backgroundOptions',
    'featOptions',
    'liveEncounter',
    'recentActionIds'
  ] as const;

  it('returns every key the +page.svelte template reads', async () => {
    const { owner, code, characterId } = await fixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: characterId }
    }));
    for (const k of REQUIRED_KEYS) {
      expect(data, `expected key ${k}`).toHaveProperty(k);
    }
    expect(data.character.id).toBe(characterId);
    expect(data.character.name).toBe('Hero');
  });

  // Locks the derive() round-trip. minCharDoc is fighter L3, str 16 →
  // saves.str.proficient=true, abilities.str.mod=3, ac~16. If derive() ever
  // failed silently against the test content the derived blob would be
  // missing — fast-fail here.
  it('derives the character against the content fixture', async () => {
    const { owner, code, characterId } = await fixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: characterId }
    }));
    expect(data.derived).not.toBeNull();
    expect(data.derived.stats.abilities.str.score).toBe(16);
    expect(data.derived.stats.abilities.str.mod).toBe(3);
    expect(data.derived.stats.totalLevel).toBe(3);
    expect(data.derived.stats.proficiencyBonus).toBe(2);
    expect(data.derived.stats.saves.str.proficient).toBe(true);
  });

  // Locks the contentMap projection — every pack row that buildContentLookup
  // returns must end up in `contentMap` (used by the client to re-derive on
  // every Y.Doc update).
  it('ships a contentMap containing every fixture pack row', async () => {
    const { owner, code, characterId } = await fixture(db);
    const data = await runLoad(load, loadEvent({
      user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: characterId }
    }));
    expect(typeof data.contentMap).toBe('object');
    const keys = Object.keys(data.contentMap);
    expect(keys.length).toBeGreaterThan(0);
    // contentMap is keyed by `${kind}/${slug}` (or similar) — check that
    // the seeded slugs are addressable.
    const ks = keys.join(' ');
    expect(ks).toMatch(/human/);
    expect(ks).toMatch(/fighter/);
    expect(ks).toMatch(/goblin/);
  });

  // Locks the document=null branch — characters without a doc still render
  // the picker options. A regression here breaks the "+ new character" flow.
  it('returns null derived when the character has no document', async () => {
    await seedMinimumContent(db);
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId, code } = await seedCampaign(db, { dmId });
    const characterId = await seedCharacter(db, {
      campaignId,
      ownerUserId: dmId,
      name: 'Blank',
      linkToCampaign: true
      // no document field
    });
    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code, id: characterId }
    }));
    expect(data.document).toBeNull();
    expect(data.derived).toBeNull();
    // Picker options still populated:
    expect(Array.isArray(data.itemOptions)).toBe(true);
    expect(Array.isArray(data.subclassOptions)).toBe(true);
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(loadEvent({
        user: null,
        params: { code: 'AAA000', id: crypto.randomUUID() }
      }))
    ).rejects.toMatchObject({ status: 303 });
  });

  it('throws 403 when the user is not a campaign member', async () => {
    const { code, characterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      load(
        loadEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { code, id: characterId }
        })
      ),
      403
    );
  });

  // Locks: a member can view but the character must be linked to *this*
  // campaign — otherwise 404. A regression in the join would silently let
  // a member view characters from any campaign they're a member of.
  it('throws 404 when the character is not linked to this campaign', async () => {
    await seedMinimumContent(db);
    const owner = await seedUser(db, { username: 'owner' });
    const dmA = await seedUser(db, { username: 'dm-a' });
    const dmB = await seedUser(db, { username: 'dm-b' });
    const { code: codeA } = await seedCampaign(db, {
      dmId: dmA,
      playerIds: [owner]
    });
    const { campaignId: campaignBId } = await seedCampaign(db, {
      dmId: dmB,
      playerIds: [owner]
    });
    // Character is linked only to campaign B, but we hit the URL for A.
    const characterId = await seedCharacter(db, {
      campaignId: campaignBId,
      ownerUserId: owner,
      name: 'B-Only',
      document: minCharDoc('h'),
      linkToCampaign: true
    });
    await expectHttpError(
      load(
        loadEvent({
          user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false },
          params: { code: codeA, id: characterId }
        })
      ),
      404
    );
  });
});
