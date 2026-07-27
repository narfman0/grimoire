import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter,
  seedContent,
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

// The characters table has no slug in the fixture helper; the resolver
// accepts the character id in the slug position (`slug OR id` match), so
// tests address /characters/<username>/<characterId>.
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

function sessionUser(id: string, username: string, isAdmin = false) {
  return { id, username, isAdmin, email: null, emailVerified: false };
}

describe('/characters/[username]/[slug] +page.server load', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  // Locks the full return shape — every key the shared CharacterSheetPage
  // template reads, plus this route's viewer-context extras.
  const REQUIRED_KEYS = [
    'user',
    'canEdit',
    'role',
    'owner',
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

  it('owner loads their own sheet with canEdit=true and every template key', async () => {
    const { owner, characterId } = await fixture(db);
    const data = await runLoad(
      load,
      loadEvent({
        user: sessionUser(owner, 'owner'),
        params: { username: 'owner', slug: characterId }
      })
    );
    for (const k of REQUIRED_KEYS) {
      expect(data, `expected key ${k}`).toHaveProperty(k);
    }
    expect(data.character.id).toBe(characterId);
    expect(data.character.name).toBe('Hero');
    expect(data.canEdit).toBe(true);
    expect(data.owner.username).toBe('owner');
    // Locks the derive() round-trip (minCharDoc is fighter L3, str 16).
    expect(data.derived).not.toBeNull();
    expect(data.derived.stats.abilities.str.score).toBe(16);
    expect(data.derived.stats.totalLevel).toBe(3);
  });

  // Class spell lists ride on spellOptions so the item spell-choice picker
  // can honor a declaration's `allowedClasses`. Rows without class data
  // ship an empty array (consumers treat that as "unknown", not "no class").
  it('spellOptions rows carry lowercase class lists', async () => {
    const { owner, characterId } = await fixture(db);
    await seedContent(db, [
      {
        kind: 'spell',
        slug: 'fireball',
        name: 'Fireball',
        data: { level: 3, school: 'evocation', classes: ['Sorcerer', 'wizard'] }
      },
      { kind: 'spell', slug: 'mystery-bolt', name: 'Mystery Bolt', data: { level: 1 } }
    ]);
    const data = await runLoad(
      load,
      loadEvent({
        user: sessionUser(owner, 'owner'),
        params: { username: 'owner', slug: characterId }
      })
    );
    const opts = data.spellOptions as Array<{ slug: string; classes: string[] }>;
    expect(opts.find((s) => s.slug === 'fireball')?.classes).toEqual(['sorcerer', 'wizard']);
    expect(opts.find((s) => s.slug === 'mystery-bolt')?.classes).toEqual([]);
  });

  // Co-member (the campaign DM here) can view but not edit: the sheet is
  // shared with everyone who shares a campaign with the character, view-only.
  it('a campaign co-member gets the sheet with canEdit=false', async () => {
    const { dmId, characterId } = await fixture(db);
    const data = await runLoad(
      load,
      loadEvent({
        user: sessionUser(dmId, 'dm'),
        params: { username: 'owner', slug: characterId }
      })
    );
    expect(data.character.id).toBe(characterId);
    expect(data.canEdit).toBe(false);
    expect(data.owner.username).toBe('owner');
    expect(data.derived).not.toBeNull();
  });

  it('throws 403 for a stranger who shares no campaign with the character', async () => {
    const { characterId } = await fixture(db);
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      load(
        loadEvent({
          user: sessionUser(stranger, 'stranger'),
          params: { username: 'owner', slug: characterId }
        })
      ),
      403
    );
  });

  it('throws 404 when no character matches the username+slug pair', async () => {
    const { owner } = await fixture(db);
    await expectHttpError(
      load(
        loadEvent({
          user: sessionUser(owner, 'owner'),
          params: { username: 'owner', slug: crypto.randomUUID() }
        })
      ),
      404
    );
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(
        loadEvent({
          user: null,
          params: { username: 'owner', slug: crypto.randomUUID() }
        })
      )
    ).rejects.toMatchObject({ status: 303 });
  });
});
