import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter
} from '$lib/server/__tests__/fixtures';
import { makeLoadEvent, runLoad, expectHttpError } from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const loadEvent = makeLoadEvent;

describe('/c/[code]/encounters +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  // Locks the load fn's return shape. The +page.svelte template reads
  // data.campaign, data.role, data.encounters[], and data.user — every key
  // here is a column the template binds to.
  it('returns campaign + role + encounters[] + user keys', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId, code } = await seedCampaign(db, { dmId, code: 'AAA111' });
    await seedEncounter(db, { campaignId, name: 'Ambush', status: 'live' });
    await seedEncounter(db, { campaignId, name: 'Boss', status: 'staging' });

    const data = await runLoad(load, loadEvent({
      user: { id: dmId, username: 'dm', isAdmin: false, email: null, emailVerified: false },
      params: { code: 'aaa111' } // exercise the uppercase normalization
    }));
    expect(data.campaign?.code).toBe('AAA111');
    expect(data.role).toBe('dm');
    expect(data.user?.id).toBe(dmId);
    expect(data.encounters.map((e: { name: string }) => e.name).sort()).toEqual(['Ambush', 'Boss']);
  });

  // Locks: players never see staging encounters (spoiler-safe).
  it('hides staging encounters from a player', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const playerId = await seedUser(db, { username: 'p' });
    const { campaignId, code } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    await seedEncounter(db, { campaignId, status: 'live', name: 'Live' });
    await seedEncounter(db, { campaignId, status: 'staging', name: 'Secret' });

    const data = await runLoad(load, loadEvent({
      user: { id: playerId, username: 'p', isAdmin: false, email: null, emailVerified: false },
      params: { code }
    }));
    const names = data.encounters.map((e: { name: string }) => e.name);
    expect(names).toContain('Live');
    expect(names).not.toContain('Secret');
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(loadEvent({ user: null, params: { code: 'ABC123' } }))
    ).rejects.toMatchObject({ status: 303 });
  });

  it('throws 403 when the user is not a campaign member', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    const { code } = await seedCampaign(db, { dmId });
    const stranger = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      load(
        loadEvent({
          user: { id: stranger, username: 'stranger', isAdmin: false, email: null, emailVerified: false },
          params: { code }
        })
      ),
      403
    );
  });
});
