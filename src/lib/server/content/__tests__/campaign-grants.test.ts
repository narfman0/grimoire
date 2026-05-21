// Integration tests for campaign content grants in buildContentLookup.
//
// Verifies that:
//   - An author's published homebrew is NOT visible to other users by default
//   - A campaign author grant makes that author's published homebrew visible
//     to all characters in the campaign, regardless of personal subscriptions
//   - Drafts (publishedAt=null) are still invisible to non-owners even with a grant
//   - Pack content is always globally visible (grant does not restrict it)

import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import { schema } from '$lib/server/db';
import {
  seedUser,
  seedCampaign,
  seedContent,
  seedContentGrant
} from '$lib/server/__tests__/fixtures';
import { buildContentLookup } from '../lookup';
import { db } from '$lib/server/db';

beforeEach(() => setupTestDb());

async function seedHomebrew(
  authorId: string,
  slug: string,
  published: boolean
): Promise<void> {
  await db
    .insert(schema.packs)
    .values({ slug: 'homebrew', name: 'Homebrew', version: '1', defaultSource: 'homebrew', loadedAt: new Date() })
    .onConflictDoNothing();
  const now = new Date();
  await db.insert(schema.content).values({
    id: crypto.randomUUID(),
    kind: 'feat',
    slug,
    version: 1,
    source: 'homebrew',
    scopeId: null,
    ownerUserId: authorId,
    packSlug: 'homebrew',
    name: slug,
    data: JSON.stringify({ activities: [{ id: 'test', type: 'passive' }] }),
    createdAt: now,
    updatedAt: now,
    visibility: 'public',
    publishedAt: published ? now : null
  });
}

describe('buildContentLookup — campaign author grants', () => {
  it('does not expose another user homebrew without a grant', async () => {
    const authorId = await seedUser(db, { username: 'author' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId } = await seedCampaign(db, { dmId: authorId, playerIds: [playerId] });
    await seedHomebrew(authorId, 'magic-feat', true);

    const { map } = await buildContentLookup(playerId, campaignId);
    const keys = Object.keys(map);
    expect(keys.some((k) => k.includes('magic-feat'))).toBe(false);
  });

  it('exposes the author homebrew once a campaign grant is added', async () => {
    const authorId = await seedUser(db, { username: 'author' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId } = await seedCampaign(db, { dmId: authorId, playerIds: [playerId] });
    await seedHomebrew(authorId, 'magic-feat', true);
    await seedContentGrant(db, { campaignId, grantType: 'author', grantKey: authorId });

    const { map } = await buildContentLookup(playerId, campaignId);
    const keys = Object.keys(map);
    expect(keys.some((k) => k.includes('magic-feat'))).toBe(true);
  });

  it('does not expose draft homebrew even with a campaign grant', async () => {
    const authorId = await seedUser(db, { username: 'author' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId } = await seedCampaign(db, { dmId: authorId, playerIds: [playerId] });
    await seedHomebrew(authorId, 'draft-feat', false); // unpublished
    await seedContentGrant(db, { campaignId, grantType: 'author', grantKey: authorId });

    const { map } = await buildContentLookup(playerId, campaignId);
    expect(Object.keys(map).some((k) => k.includes('draft-feat'))).toBe(false);
  });

  it('the author themselves always sees their own draft regardless of grants', async () => {
    const authorId = await seedUser(db, { username: 'author' });
    const { campaignId } = await seedCampaign(db, { dmId: authorId });
    await seedHomebrew(authorId, 'draft-feat', false);

    const { map } = await buildContentLookup(authorId, campaignId);
    expect(Object.keys(map).some((k) => k.includes('draft-feat'))).toBe(true);
  });

  it('grant without campaignId param has no effect', async () => {
    const authorId = await seedUser(db, { username: 'author' });
    const playerId = await seedUser(db, { username: 'player' });
    const { campaignId } = await seedCampaign(db, { dmId: authorId, playerIds: [playerId] });
    await seedHomebrew(authorId, 'magic-feat', true);
    await seedContentGrant(db, { campaignId, grantType: 'author', grantKey: authorId });

    // No campaignId passed — grants not applied.
    const { map } = await buildContentLookup(playerId, undefined);
    expect(Object.keys(map).some((k) => k.includes('magic-feat'))).toBe(false);
  });

  it('pack content is globally visible without any grant', async () => {
    const playerId = await seedUser(db, { username: 'player' });
    const dmId = await seedUser(db, { username: 'dm' });
    const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
    await seedContent(db, [{ kind: 'feat', slug: 'pack-feat', data: {} }]);

    const { map } = await buildContentLookup(playerId, campaignId);
    expect(Object.keys(map).some((k) => k.includes('pack-feat'))).toBe(true);
  });
});
