// Table mode, named-URL scheme. Same access rule as the code-scoped twin
// and as the interactive encounter page: logged in + approved member.
import { error, redirect } from '@sveltejs/kit';
import {
  requireMembershipByCode,
  resolveCampaignByDmAndSlug
} from '$lib/server/auth/membership';
import { buildEncounterDisplayData } from '$lib/server/encounter-display';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const resolved = await resolveCampaignByDmAndSlug(params.dmUsername, params.slug);
  if (!resolved) throw error(404, 'campaign not found');
  await requireMembershipByCode(locals.user, resolved.code);
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
    ...(await buildEncounterDisplayData(campaign, params.id))
  };
};
