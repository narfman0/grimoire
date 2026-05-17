import { redirect } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
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

  let campaigns: Array<{ id: string; code: string; name: string; role: string; joinedAt: number }> = [];
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
    const byId = new Map(rows.map((r) => [r.id, r]));
    campaigns = memberships
      .map((m) => {
        const c = byId.get(m.campaignId);
        if (!c) return null;
        return { id: c.id, code: c.code, name: c.name, role: m.role, joinedAt: m.joinedAt.getTime() };
      })
      .filter((c): c is NonNullable<typeof c> => c != null)
      .sort((a, b) => b.joinedAt - a.joinedAt);
  }

  return {
    user: locals.user,
    campaigns
  };
};
