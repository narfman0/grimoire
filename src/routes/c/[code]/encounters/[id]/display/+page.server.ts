// Table mode, code-scoped URL scheme. Access is the same rule as the
// interactive encounter page: logged in + approved member of the campaign.
// Table mode shows less than the player view does, never more, so there is
// no reason for it to be *harder* to reach — and no reason to invent a
// code-only unauthenticated path either, which is what the alternative
// ("anyone holding the campaign code can project it") would require.
import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { buildEncounterDisplayData } from '$lib/server/encounter-display';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  await requireMembershipByCode(locals.user, code);

  const campaignRows = await db
    .select({ id: schema.campaigns.id, code: schema.campaigns.code, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  const campaign = campaignRows[0];

  return {
    campaign,
    user: locals.user,
    ...(await buildEncounterDisplayData(campaign, params.id))
  };
};
