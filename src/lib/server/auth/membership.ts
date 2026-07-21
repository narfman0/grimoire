// Campaign membership checks. Routes that gate on "must be in this campaign"
// call requireMembership(); page loads can call getMembership() to vary the
// UI based on role (dm vs player).

import { and, eq, or } from 'drizzle-orm';
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

/** Resolves /campaigns/<dmUsername>/<slug> to the campaign row (id, code, name, slug).
 *  Returns null when no matching campaign exists. */
export async function resolveCampaignByDmAndSlug(
  dmUsername: string,
  slug: string
): Promise<{ id: string; code: string; name: string; slug: string } | null> {
  const rows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name,
      slug: schema.campaigns.slug
    })
    .from(schema.campaigns)
    .innerJoin(
      schema.campaignMembers,
      and(
        eq(schema.campaignMembers.campaignId, schema.campaigns.id),
        eq(schema.campaignMembers.role, 'dm')
      )
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.campaignMembers.userId))
    .where(
      and(eq(schema.users.username, dmUsername), eq(schema.campaigns.slug, slug))
    )
    .limit(1);
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    code: rows[0].code,
    name: rows[0].name,
    slug: rows[0].slug ?? slug
  };
}

/** Resolves /characters/<username>/<slug> to the character row.
 *  Returns null when no matching character exists. */
export async function resolveCharacterByOwnerAndSlug(
  username: string,
  slug: string
): Promise<{
  id: string;
  ownerUserId: string | null;
  ownerUsername: string | null;
  name: string;
  slug: string | null;
  document: string | null;
  updatedAt: Date;
} | null> {
  const rows = await db
    .select({
      id: schema.characters.id,
      ownerUserId: schema.characters.ownerUserId,
      ownerUsername: schema.users.username,
      name: schema.characters.name,
      slug: schema.characters.slug,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .innerJoin(schema.users, eq(schema.users.id, schema.characters.ownerUserId))
    .where(
      and(
        eq(schema.users.username, username),
        or(eq(schema.characters.slug, slug), eq(schema.characters.id, slug))
      )
    )
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

/** Authorises access to a character sheet. Throws 401/403 if the viewer has
 *  no access. Returns `canEdit` (owner/admin) and the set of campaign ids the
 *  viewer shares with the character (used to filter live-encounter visibility). */
export async function requireCharacterViewAccess(
  user: { id: string; isAdmin: boolean },
  character: { id: string; ownerUserId: string | null }
): Promise<{ canEdit: boolean; sharedCampaignIds: string[] }> {
  const isOwner = character.ownerUserId === user.id;
  if (isOwner || user.isAdmin) {
    return { canEdit: true, sharedCampaignIds: [] };
  }
  // Viewer is not the owner — check whether they share a campaign with this character.
  const sharedRows = await db
    .select({ campaignId: schema.campaignCharacters.campaignId })
    .from(schema.campaignCharacters)
    .innerJoin(
      schema.campaignMembers,
      and(
        eq(schema.campaignMembers.campaignId, schema.campaignCharacters.campaignId),
        eq(schema.campaignMembers.userId, user.id),
        eq(schema.campaignMembers.status, 'approved')
      )
    )
    .where(eq(schema.campaignCharacters.characterId, character.id));
  if (sharedRows.length === 0) throw error(403, 'not authorised to view this character');
  return {
    canEdit: false,
    sharedCampaignIds: sharedRows.map((r) => r.campaignId)
  };
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
