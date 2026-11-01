// Table view — landscape/tablet dashboard for a campaign member. Same
// payload (and the same player lens) as the spectator link; the DM gets
// quick HP controls on top. See $lib/server/party-dashboard.

import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getMembershipByCode } from '$lib/server/auth/membership';
import { buildPartyDashboard } from '$lib/server/party-dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const membership = await getMembershipByCode(locals.user.id, code);
  if (!membership) throw error(403, 'not a member of this campaign');
  const [campaign] = await db
    .select({ id: schema.campaigns.id, code: schema.campaigns.code, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, membership.campaignId))
    .limit(1);
  if (!campaign) throw error(404, 'campaign not found');
  return {
    campaign: { code: campaign.code, name: campaign.name },
    role: membership.role,
    dashboard: await buildPartyDashboard(campaign),
    wide: true
  };
};
