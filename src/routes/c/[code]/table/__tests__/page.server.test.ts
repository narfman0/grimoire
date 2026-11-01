import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedMinimumContent
} from '$lib/server/__tests__/fixtures';
import { makeLoadEvent, runLoad, expectHttpError } from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

type Db = ReturnType<typeof setupTestDb>;
const asUser = (id: string) => ({ id, username: 'u', isAdmin: false, email: null, emailVerified: false });

describe('/c/[code]/table load', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('gives the DM the player lens — hidden creatures never reach the table', async () => {
    await seedMinimumContent(db);
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId, code: 'TABLEP' });
    const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
    await seedParticipant(db, { encounterId, kind: 'monster', name: 'Lurker', reveals: { hidden: true } });
    await seedParticipant(db, { encounterId, kind: 'monster', name: 'Ogre' });

    const data = await runLoad(load, makeLoadEvent({ user: asUser(dmId), params: { code: 'tablep' } }));
    expect(data.role).toBe('dm');
    expect(data.dashboard.encounter.combatants.map((c: { name: string }) => c.name)).toEqual(['Enemy 1']);
    expect(JSON.stringify(data)).not.toContain('Lurker');
  });

  it('rejects non-members', async () => {
    const dmId = await seedUser(db, { username: 'dm' });
    await seedCampaign(db, { dmId, code: 'TABLEP' });
    const strangerId = await seedUser(db, { username: 'x' });
    await expectHttpError(load(makeLoadEvent({ user: asUser(strangerId), params: { code: 'TABLEP' } })), 403);
  });
});
