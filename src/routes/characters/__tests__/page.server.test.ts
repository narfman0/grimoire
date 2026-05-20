import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter
} from '$lib/server/__tests__/fixtures';
import { makeLoadEvent, runLoad } from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const loadEvent = makeLoadEvent;

const minDoc = (id: string) => ({
  id,
  name: 'Hero',
  classes: [
    { slug: 'fighter', level: 2, hpRolledPerLevel: [10, 6] },
    { slug: 'rogue', level: 1, hpRolledPerLevel: [4] }
  ],
  species: { kind: 'species', slug: 'human', version: 1, choices: {} }
});

describe('/characters +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the return shape — template reads data.user + data.characters[].
  it('returns owned characters with descLine + totalLevel + campaigns[]', async () => {
    const owner = await seedUser(db, { username: 'owner' });
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, {
      dmId,
      playerIds: [owner],
      name: 'Camp One'
    });
    const cid = await seedCharacter(db, {
      campaignId,
      ownerUserId: owner,
      name: 'Hero',
      document: minDoc('seed')
    });

    const data = await runLoad(load, loadEvent({
      user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false }
    }));
    expect(data.user.id).toBe(owner);
    expect(data.characters.length).toBe(1);
    const c = data.characters[0];
    expect(c.id).toBe(cid);
    expect(c.name).toBe('Hero');
    expect(c.totalLevel).toBe(3); // fighter 2 + rogue 1
    expect(c.descLine).toContain('human');
    expect(c.descLine).toContain('fighter 2');
    expect(c.descLine).toContain('rogue 1');
    // campaigns[] is empty here because we didn't insert a campaignCharacters
    // join row — keeps the test independent of that side of the schema.
    expect(c.campaigns).toEqual([]);
  });

  it('redirects to /login when not signed in', async () => {
    await expect(load(loadEvent({ user: null }))).rejects.toMatchObject({ status: 303 });
  });

  it('returns an empty characters list for a user with no characters', async () => {
    const u = await seedUser(db, { username: 'fresh' });
    const data = await runLoad(load, loadEvent({
      user: { id: u, username: 'fresh', isAdmin: false, email: null, emailVerified: false }
    }));
    expect(data.characters).toEqual([]);
  });

  // Locks: a corrupt document JSON doesn't crash the load fn; the descLine
  // just blanks. Regression here could make the entire /characters page
  // 500 for a user.
  it('does not crash on a malformed document JSON; surfaces a blank descLine', async () => {
    const owner = await seedUser(db, { username: 'owner' });
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [owner] });
    // Insert via raw drizzle to bypass the seedCharacter helper's JSON.stringify.
    const { schema } = await import('$lib/server/__tests__/test-db');
    await db.insert(schema.characters).values({
      id: crypto.randomUUID(),
      campaignId,
      ownerUserId: owner,
      name: 'Broken',
      document: 'not-json',
      updatedAt: new Date()
    });
    const data = await runLoad(load, loadEvent({
      user: { id: owner, username: 'owner', isAdmin: false, email: null, emailVerified: false }
    }));
    expect(data.characters[0].descLine).toBe('');
    expect(data.characters[0].totalLevel).toBe(0);
  });
});
