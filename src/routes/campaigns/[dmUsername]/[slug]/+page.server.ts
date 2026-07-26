import { redirect, error } from '@sveltejs/kit';
import {
  getMembershipWithStatus,
  resolveCampaignByDmAndSlug
} from '$lib/server/auth/membership';
import { buildCampaignPageData, EMPTY_CAMPAIGN_PAGE } from '$lib/server/campaign-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Resolve /campaigns/<dmUsername>/<slug> → the underlying campaign (still
  // keyed by code/UUID for membership + APIs).
  const resolved = await resolveCampaignByDmAndSlug(params.dmUsername, params.slug);
  if (!resolved) throw error(404, 'campaign not found');
  const campaign = {
    id: resolved.id,
    code: resolved.code,
    name: resolved.name,
    slug: resolved.slug,
    dmUsername: params.dmUsername
  };

  const membership = await getMembershipWithStatus(locals.user.id, resolved.code);
  if (!membership) throw error(403, 'not a member of this campaign');

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
