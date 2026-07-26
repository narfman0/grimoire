import { error, redirect } from '@sveltejs/kit';
import {
  requireMembershipByCode,
  resolveCampaignByDmAndSlug
} from '$lib/server/auth/membership';
import { buildEncounterPageData } from '$lib/server/encounter-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const resolved = await resolveCampaignByDmAndSlug(params.dmUsername, params.slug);
  if (!resolved) throw error(404, 'campaign not found');
  const m = await requireMembershipByCode(locals.user, resolved.code);
  const campaign = {
    id: resolved.id,
    code: resolved.code,
    name: resolved.name,
    slug: resolved.slug,
    dmUsername: params.dmUsername
  };

  return {
    campaign,
    user: locals.user,
    role: m.role,
    ...(await buildEncounterPageData(campaign, params.id, m.role === 'dm'))
  };
};
