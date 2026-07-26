import { redirect, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getMembershipWithStatus } from '$lib/server/auth/membership';
import { buildCampaignPageData, EMPTY_CAMPAIGN_PAGE } from '$lib/server/campaign-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const membership = await getMembershipWithStatus(locals.user.id, code);
  if (!membership) throw error(403, 'not a member of this campaign');

  const campaignRows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  const campaign = campaignRows[0];

  // Pending/rejected members see a status page instead of the campaign content.
  if (membership.status === 'pending' || membership.status === 'rejected') {
    return {
      pending: membership.status === 'pending',
      rejected: membership.status === 'rejected',
      campaign,
      user: locals.user,
      role: 'player' as const,
      ...EMPTY_CAMPAIGN_PAGE,
    };
  }

  return {
    pending: false,
    rejected: false,
    campaign,
    user: locals.user,
    role: membership.role,
    ...(await buildCampaignPageData(locals.user, campaign, membership.role))
  };
};
