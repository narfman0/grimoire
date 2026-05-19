import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedCharacter
} from '$lib/server/__tests__/fixtures';
import { makeLoadEvent, runLoad, expectHttpError } from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const loadEvent = makeLoadEvent;

const REQUIRED_KEYS = [
  'campaign',
  'user',
  'role',
  'notes',
  'characters',
  'linkableCharacters',
  'speciesOptions',
  'classOptions',
  'backgroundOptions',
  'subclassOptions'
] as const;

describe('/c/[code] +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // The campaign overview page is one of the highest-traffic routes; its
  // template binds against ~10 distinct `data.X` keys. Lock that the load
  // fn returns every one — this is the regression class from `4f347c0`
  // (template referenced backgroundOptions but load forgot to provide it).
  it('returns every key the +page.svelte template reads', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { code } = await seedCampaign(db, { dmId });

    const data = await runLoad(load, loadEvent({
        user: { id: dmId, username: 'dm', isAdmin: false },
        params: { code }
      })
    );
    for (const k of REQUIRED_KEYS) {
      expect(data, `expected key ${k}`).toHaveProperty(k);
    }
    expect(data.role).toBe('dm');
    expect(data.user.id).toBe(dmId);
    expect(data.campaign?.code).toBe(code);
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(loadEvent({ user: null, params: { code: 'ABC123' } }))
    ).rejects.toMatchObject({ status: 303 });
  });

  it('throws 403 when the user is not a member', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { code } = await seedCampaign(db, { dmId });
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      load(
        loadEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false },
          params: { code }
        })
      ),
      403
    );
  });

  // Locks: the linkableCharacters picker only surfaces the current user's
  // own characters NOT already linked to this campaign.
  it('linkableCharacters excludes characters already linked to this campaign', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId, code } = await seedCampaign(db, { dmId });
    // Seed two characters owned by the DM, neither linked to this campaign.
    await seedCharacter(db, { campaignId, ownerUserId: dmId, name: 'A' });
    await seedCharacter(db, { campaignId, ownerUserId: dmId, name: 'B' });
    const data = await runLoad(load, loadEvent({
        user: { id: dmId, username: 'dm', isAdmin: false },
        params: { code }
      })
    );
    // Both are owned by the DM; they show up in linkableCharacters
    // (we didn't insert campaign_characters rows so they aren't already linked).
    expect(data.linkableCharacters.map((c: { name: string }) => c.name).sort()).toEqual(['A', 'B']);
  });
});
