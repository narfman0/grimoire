import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import {
  seedUser,
  seedCampaign,
  seedEncounter,
  seedParticipant,
  seedMinimumContent
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
  const { campaignId } = await seedCampaign(db, { dmId });
  // The named route resolves /campaigns/<dmUsername>/<slug>; the fixture
  // helper doesn't assign slugs, so set one directly.
  await db
    .update(schema.campaigns)
    .set({ slug: 'test-campaign' })
    .where(eq(schema.campaigns.id, campaignId));
  const encounterId = await seedEncounter(db, {
    campaignId,
    status: 'live',
    name: 'Goblin Den'
  });
  const monsterId = await seedParticipant(db, {
    encounterId,
    kind: 'monster',
    name: 'Goblin',
    statblockSlug: 'goblin'
  });
  return { dmId, campaignId, encounterId, monsterId };
}

function sessionUser(id: string, username: string) {
  return { id, username, isAdmin: false, email: null, emailVerified: false };
}

describe('/campaigns/[dmUsername]/[slug]/encounters/[id] +page.server load', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('loads the encounter for a campaign member via the named URL', async () => {
    const { dmId, encounterId } = await fixture(db);
    const data = await runLoad(load, loadEvent({
      user: sessionUser(dmId, 'dm'),
      params: { dmUsername: 'dm', slug: 'test-campaign', id: encounterId }
    }));
    expect(data.encounter.id).toBe(encounterId);
    expect(data.role).toBe('dm');
    expect(data.campaign.dmUsername).toBe('dm');
    expect(data.campaign.slug).toBe('test-campaign');
    // Shared-core keys the EncounterPage template reads.
    for (const k of [
      'participants',
      'characterLinks',
      'monsterOptions',
      'participantPlans',
      'actionLog',
      'party'
    ]) {
      expect(data, `expected key ${k}`).toHaveProperty(k);
    }
  });

  it('rejects a non-member with 403', async () => {
    const { encounterId } = await fixture(db);
    const strangerId = await seedUser(db, { username: 'stranger' });
    await expectHttpError(
      load(loadEvent({
        user: sessionUser(strangerId, 'stranger'),
        params: { dmUsername: 'dm', slug: 'test-campaign', id: encounterId }
      })),
      403
    );
  });

  it('throws 404 for an unknown dmUsername/slug pair', async () => {
    const { dmId, encounterId } = await fixture(db);
    await expectHttpError(
      load(loadEvent({
        user: sessionUser(dmId, 'dm'),
        params: { dmUsername: 'dm', slug: 'nope', id: encounterId }
      })),
      404
    );
  });

  it('redirects to /login when not signed in', async () => {
    await expect(
      load(loadEvent({
        user: null,
        params: { dmUsername: 'dm', slug: 'test-campaign', id: crypto.randomUUID() }
      }))
    ).rejects.toMatchObject({ status: 303 });
  });
});
