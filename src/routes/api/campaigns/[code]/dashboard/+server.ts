// Party dashboard for campaign members — the table view's poll. Same payload
// as the spectator link (GET /api/watch/[token]) and the same player lens,
// even for the DM: the table view is a screen everyone at the table can see.

import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, PartyDashboardResponse } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { buildPartyDashboard, dashboardResponse } from '$lib/server/party-dashboard';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const GET: RequestHandler = async ({ params, locals, request }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);
  const [campaign] = await db
    .select({ id: schema.campaigns.id, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, m.campaignId))
    .limit(1);
  if (!campaign) throw error(404, 'campaign not found');
  return dashboardResponse(request, await buildPartyDashboard(campaign));
};

export const _openapi = {
  GET: {
    summary: 'Party dashboard (player lens) for campaign members — backs the table view',
    description:
      'Same payload as the spectator link. Carries an `ETag`; echo it via `If-None-Match` ' +
      'to get a bodyless 304 when nothing changed.',
    params: Params,
    response: PartyDashboardResponse,
    errors: [
      { status: 304, description: 'Not modified — If-None-Match matched the current ETag' },
      401,
      403,
      404
    ]
  }
} as const;
