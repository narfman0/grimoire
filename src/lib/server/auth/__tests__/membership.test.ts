import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, schema } from '../../__tests__/test-db';
import {
  getMembershipByCode,
  getMembershipByCampaignId,
  requireMembershipByCode
} from '../membership';

type Db = ReturnType<typeof setupTestDb>;

async function seedUserAndCampaign(
  db: Db,
  opts: { role?: 'dm' | 'player'; code?: string } = {}
) {
  const userId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const code = opts.code ?? 'ABC123';
  await db.insert(schema.users).values({
    id: userId,
    username: `u-${userId.slice(0, 6)}`,
    passwordHash: 'x:y',
    isAdmin: false,
    createdAt: new Date()
  });
  await db.insert(schema.campaigns).values({
    id: campaignId,
    code,
    name: 'Test',
    createdAt: new Date()
  });
  await db.insert(schema.campaignMembers).values({
    campaignId,
    userId,
    role: opts.role ?? 'player',
    joinedAt: new Date()
  });
  return { userId, campaignId, code };
}

describe('membership', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
  });

  it('getMembershipByCode returns campaignId + code + role for a member', async () => {
    const { userId, campaignId, code } = await seedUserAndCampaign(db, { role: 'dm' });
    const m = await getMembershipByCode(userId, code);
    expect(m).toEqual({ campaignId, campaignCode: code, role: 'dm' });
  });

  it('getMembershipByCode returns null when the user is not a member', async () => {
    const { code } = await seedUserAndCampaign(db);
    const otherUserId = crypto.randomUUID();
    expect(await getMembershipByCode(otherUserId, code)).toBeNull();
  });

  it('getMembershipByCode returns null for an unknown campaign code', async () => {
    const { userId } = await seedUserAndCampaign(db);
    expect(await getMembershipByCode(userId, 'NONEXISTENT')).toBeNull();
  });

  // Locks the requireMembershipByCode error semantics: anonymous = 401,
  // not-a-member = 403. Every campaign-scoped API + page relies on this
  // distinction.
  it('requireMembershipByCode throws 401 when user is null', async () => {
    await expect(requireMembershipByCode(null, 'ABC123')).rejects.toMatchObject({
      status: 401
    });
  });

  it('requireMembershipByCode throws 403 when user is not a member', async () => {
    const { code } = await seedUserAndCampaign(db);
    const other = { id: crypto.randomUUID() };
    await expect(requireMembershipByCode(other, code)).rejects.toMatchObject({
      status: 403
    });
  });

  it('requireMembershipByCode returns the membership when present', async () => {
    const { userId, campaignId, code } = await seedUserAndCampaign(db, { role: 'dm' });
    const m = await requireMembershipByCode({ id: userId }, code);
    expect(m).toEqual({ campaignId, campaignCode: code, role: 'dm' });
  });

  it('getMembershipByCampaignId returns the role or null', async () => {
    const { userId, campaignId } = await seedUserAndCampaign(db, { role: 'player' });
    expect(await getMembershipByCampaignId(userId, campaignId)).toBe('player');
    expect(
      await getMembershipByCampaignId(crypto.randomUUID(), campaignId)
    ).toBeNull();
  });
});
