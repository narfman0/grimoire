import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '$lib/server/__tests__/test-db';
import { seedUser, seedCampaign, seedTestPack, seedContentGrant } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET, POST } from '../+server';
import { DELETE } from '../[id]/+server';

type Db = ReturnType<typeof setupTestDb>;

const CODE = 'ABCDEF'; // valid 6-char Crockford base32

function asUser(id: string, username = 'user') {
  return { id, username, isAdmin: false, email: null, emailVerified: false };
}

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId], code: CODE });
  await seedTestPack(db);
  return { dmId, playerId, campaignId, code: CODE };
}

describe('GET /api/campaigns/[code]/grants', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('returns 401 without a session', async () => {
    await fixture(db);
    await expectHttpError(GET(makeEvent({ user: null, params: { code: CODE } })), 401);
  });

  it('returns 403 for a non-member', async () => {
    await fixture(db);
    const strangerId = await seedUser(db, { username: 'stranger' });
    await expectHttpError(GET(makeEvent({ user: asUser(strangerId, 'stranger'), params: { code: CODE } })), 403);
  });

  it('returns empty list when no grants exist', async () => {
    const { dmId } = await fixture(db);
    const res = await GET(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns existing grants with resolved author label', async () => {
    const { dmId, playerId, campaignId } = await fixture(db);
    await seedContentGrant(db, { campaignId, grantType: 'author', grantKey: playerId });
    const res = await GET(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].grantType).toBe('author');
    expect(body[0].label).toBe('player');
  });

  it('player can also list grants', async () => {
    const { playerId } = await fixture(db);
    const res = await GET(makeEvent({ user: asUser(playerId, 'player'), params: { code: CODE } }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/campaigns/[code]/grants', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('returns 401 without a session', async () => {
    await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: null, params: { code: CODE }, body: { grantType: 'pack', grantKey: 'test-fixture' } })),
      401
    );
  });

  it('returns 403 for a player', async () => {
    const { playerId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: asUser(playerId, 'player'), params: { code: CODE }, body: { grantType: 'pack', grantKey: 'test-fixture' } })),
      403
    );
  });

  it('returns 404 for an unknown pack slug', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'pack', grantKey: 'no-such-pack' } })),
      404
    );
  });

  it('creates a pack grant and returns 201', async () => {
    const { dmId } = await fixture(db);
    const res = await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'pack', grantKey: 'test-fixture' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grantType).toBe('pack');
    expect(body.grantKey).toBe('test-fixture');
    expect(body.id).toBeTruthy();
  });

  it('returns 409 on duplicate pack grant', async () => {
    const { dmId } = await fixture(db);
    await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'pack', grantKey: 'test-fixture' } }));
    await expectHttpError(
      POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'pack', grantKey: 'test-fixture' } })),
      409
    );
  });

  it('returns 404 for unknown author username', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(
      POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'author', grantKey: 'nobody' } })),
      404
    );
  });

  it('creates an author grant by username and returns 201 with label', async () => {
    const { dmId, playerId } = await fixture(db);
    const res = await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'author', grantKey: 'player' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grantType).toBe('author');
    expect(body.grantKey).toBe(playerId);
    expect(body.label).toBe('player');
  });

  it('creates an author grant by user ID', async () => {
    const { dmId, playerId } = await fixture(db);
    const res = await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'author', grantKey: playerId } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.grantKey).toBe(playerId);
  });

  it('returns 409 on duplicate author grant', async () => {
    const { dmId } = await fixture(db);
    await POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'author', grantKey: 'player' } }));
    await expectHttpError(
      POST(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE }, body: { grantType: 'author', grantKey: 'player' } })),
      409
    );
  });
});

describe('DELETE /api/campaigns/[code]/grants/[id]', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('returns 401 without a session', async () => {
    await fixture(db);
    await expectHttpError(DELETE(makeEvent({ user: null, params: { code: CODE, id: 'fake-id' } })), 401);
  });

  it('returns 403 for a player', async () => {
    const { playerId, campaignId } = await fixture(db);
    const grantId = await seedContentGrant(db, { campaignId, grantType: 'pack', grantKey: 'test-fixture' });
    await expectHttpError(
      DELETE(makeEvent({ user: asUser(playerId, 'player'), params: { code: CODE, id: grantId } })),
      403
    );
  });

  it('returns 404 for a non-existent grant', async () => {
    const { dmId } = await fixture(db);
    await expectHttpError(
      DELETE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, id: 'no-such-grant' } })),
      404
    );
  });

  it('deletes an existing grant and returns ok', async () => {
    const { dmId, campaignId } = await fixture(db);
    const grantId = await seedContentGrant(db, { campaignId, grantType: 'pack', grantKey: 'test-fixture' });
    const res = await DELETE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, id: grantId } }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('returns 404 when deleting a grant from a different campaign', async () => {
    const { dmId } = await fixture(db);
    const otherId = await seedUser(db, { username: 'dm2' });
    const { campaignId: othCampaignId } = await seedCampaign(db, { dmId: otherId, code: 'BCDEFG' });
    const othGrantId = await seedContentGrant(db, { campaignId: othCampaignId, grantType: 'pack', grantKey: 'test-fixture' });
    await expectHttpError(
      DELETE(makeEvent({ user: asUser(dmId, 'dm'), params: { code: CODE, id: othGrantId } })),
      404
    );
  });
});
