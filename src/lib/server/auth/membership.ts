// Campaign membership checks. Routes that gate on "must be in this campaign"
// call requireMembership(); page loads can call getMembership() to vary the
// UI based on role (dm vs player).

import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';

export type Role = 'dm' | 'player';
export type MemberStatus = 'pending' | 'approved' | 'rejected';

export interface Membership {
  campaignId: string;
  campaignCode: string;
  role: Role;
}

export interface MembershipWithStatus extends Membership {
  status: MemberStatus;
}

/** Returns approved membership or null; does not throw. Pending/rejected members return null. */
export async function getMembershipByCode(
  userId: string,
  campaignCode: string
): Promise<Membership | null> {
  const rows = await db
    .select({
      campaignId: schema.campaigns.id,
      code: schema.campaigns.code,
      role: schema.campaignMembers.role
    })
    .from(schema.campaignMembers)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaigns.id, schema.campaignMembers.campaignId)
    )
    .where(
      and(
        eq(schema.campaigns.code, campaignCode),
        eq(schema.campaignMembers.userId, userId),
        eq(schema.campaignMembers.status, 'approved')
      )
    )
    .limit(1);
  if (rows.length === 0) return null;
  return {
    campaignId: rows[0].campaignId,
    campaignCode: rows[0].code,
    role: rows[0].role as Role
  };
}

/** Returns membership including pending/rejected status; does not throw. */
export async function getMembershipWithStatus(
  userId: string,
  campaignCode: string
): Promise<MembershipWithStatus | null> {
  const rows = await db
    .select({
      campaignId: schema.campaigns.id,
      code: schema.campaigns.code,
      role: schema.campaignMembers.role,
      status: schema.campaignMembers.status
    })
    .from(schema.campaignMembers)
    .innerJoin(
      schema.campaigns,
      eq(schema.campaigns.id, schema.campaignMembers.campaignId)
    )
    .where(
      and(eq(schema.campaigns.code, campaignCode), eq(schema.campaignMembers.userId, userId))
    )
    .limit(1);
  if (rows.length === 0) return null;
  return {
    campaignId: rows[0].campaignId,
    campaignCode: rows[0].code,
    role: rows[0].role as Role,
    status: rows[0].status as MemberStatus
  };
}

/** Returns approved membership or throws 401/403. Pending/rejected members get 403. */
export async function requireMembershipByCode(
  user: { id: string } | null,
  campaignCode: string
): Promise<Membership> {
  if (!user) throw error(401, 'login required');
  const m = await getMembershipByCode(user.id, campaignCode);
  if (!m) throw error(403, 'not a member of this campaign');
  return m;
}

export async function getMembershipByCampaignId(
  userId: string,
  campaignId: string
): Promise<Role | null> {
  const rows = await db
    .select({ role: schema.campaignMembers.role })
    .from(schema.campaignMembers)
    .where(
      and(
        eq(schema.campaignMembers.campaignId, campaignId),
        eq(schema.campaignMembers.userId, userId),
        eq(schema.campaignMembers.status, 'approved')
      )
    )
    .limit(1);
  return rows.length === 0 ? null : (rows[0].role as Role);
}
