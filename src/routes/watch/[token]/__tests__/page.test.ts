import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import { seedUser, seedCampaign, seedMinimumContent } from '$lib/server/__tests__/fixtures';
import { makeLoadEvent, runLoad, expectHttpError } from '$lib/server/__tests__/test-event';
import { rotateSpectatorToken, revokeSpectatorToken } from '$lib/server/spectator-token';
import { load } from '../+page.server';

describe('/watch/[token] load', () => {
  beforeEach(() => {
    setupTestDb();
  });

  it('loads without a session and never ships the join code or campaign id', async () => {
    const db = setupTestDb();
    await seedMinimumContent(db);
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId, code } = await seedCampaign(db, { dmId, code: 'WATCHP' });
    const token = await rotateSpectatorToken(campaignId);

    const data = await runLoad(load, makeLoadEvent({ user: null, params: { token } }));
    expect(data.dashboard.campaign.name).toBe('Test Campaign');
    expect(data.campaign).toBeUndefined();
    const raw = JSON.stringify(data);
    expect(raw).not.toContain(code);
    expect(raw).not.toContain(campaignId);

    await revokeSpectatorToken(campaignId);
    await expectHttpError(load(makeLoadEvent({ user: null, params: { token } })), 404);
  });

  it('404s a malformed token', async () => {
    await expectHttpError(load(makeLoadEvent({ user: null, params: { token: 'nope' } })), 404);
  });
});
