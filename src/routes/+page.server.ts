import { redirect } from '@sveltejs/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  // List campaigns this user is a member of, with role.
  const memberships = await db
    .select({
      campaignId: schema.campaignMembers.campaignId,
      role: schema.campaignMembers.role,
      joinedAt: schema.campaignMembers.joinedAt
    })
    .from(schema.campaignMembers)
    .where(eq(schema.campaignMembers.userId, locals.user.id));

  let campaigns: Array<{
    id: string;
    code: string;
    name: string;
    role: string;
    joinedAt: number;
    characterCount: number;
    encounterCount: number;
  }> = [];
  if (memberships.length > 0) {
    const ids = memberships.map((m) => m.campaignId);

    const rows = await db
      .select({
        id: schema.campaigns.id,
        code: schema.campaigns.code,
        name: schema.campaigns.name
      })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.id, ids));

    // Per-campaign character + encounter counts in one round-trip each.
    // Counts surface in the home-page list so the user can pick up where
    // the most action lives at a glance.
    const charCounts = await db
      .select({
        campaignId: schema.characters.campaignId,
        count: sql<number>`count(*)`
      })
      .from(schema.characters)
      .where(inArray(schema.characters.campaignId, ids))
      .groupBy(schema.characters.campaignId);
    const encCounts = await db
      .select({
        campaignId: schema.encounters.campaignId,
        count: sql<number>`count(*)`
      })
      .from(schema.encounters)
      .where(inArray(schema.encounters.campaignId, ids))
      .groupBy(schema.encounters.campaignId);

    const byId = new Map(rows.map((r) => [r.id, r]));
    const charByCampaign = new Map(charCounts.map((c) => [c.campaignId, Number(c.count)]));
    const encByCampaign = new Map(encCounts.map((c) => [c.campaignId, Number(c.count)]));
    campaigns = memberships
      .map((m) => {
        const c = byId.get(m.campaignId);
        if (!c) return null;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          role: m.role,
          joinedAt: m.joinedAt.getTime(),
          characterCount: charByCampaign.get(c.id) ?? 0,
          encounterCount: encByCampaign.get(c.id) ?? 0
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null)
      .sort((a, b) => b.joinedAt - a.joinedAt);
  }

  return {
    user: locals.user,
    campaigns
  };
};
