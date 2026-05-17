import { redirect } from '@sveltejs/kit';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(locals.user, code);

  const campaignRows = await db
    .select({ id: schema.campaigns.id, code: schema.campaigns.code, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  const campaign = campaignRows[0];

  const encounterRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.campaignId, m.campaignId))
    .orderBy(desc(schema.encounters.createdAt));

  return {
    campaign,
    user: locals.user,
    role: m.role,
    encounters: encounterRows.map((e) => ({
      id: e.id,
      campaignId: e.campaignId,
      name: e.name,
      status: e.status,
      round: e.round,
      activeParticipantId: e.activeParticipantId,
      createdAt: e.createdAt.getTime(),
      endedAt: e.endedAt ? e.endedAt.getTime() : null
    }))
  };
};
