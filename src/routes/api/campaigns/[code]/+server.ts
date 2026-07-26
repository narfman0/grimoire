import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Campaign, CampaignCode, UpdateCampaignRequest } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { isRateLimited } from '$lib/server/auth/rate-limit';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const GET: RequestHandler = async ({ params, locals, getClientAddress }) => {
  // Unauthenticated by design (the join page previews the campaign name),
  // but throttle anonymous lookups so 6-char codes can't be enumerated.
  if (!locals.user && isRateLimited(`campaign-lookup:${getClientAddress()}`, 20, 15 * 60 * 1000)) {
    throw error(429, 'too many lookups — try again later');
  }
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);

  const rows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (rows.length === 0) throw error(404, 'campaign not found');
  return json(rows[0]);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  // DM-only — players can't rename a campaign they joined.
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can rename the campaign');

  const patch = await parseJson(request, UpdateCampaignRequest);
  const updates: Partial<typeof schema.campaigns.$inferInsert> = {};
  if (patch.name !== undefined) updates.name = patch.name;

  await db.update(schema.campaigns).set(updates).where(eq(schema.campaigns.id, m.campaignId));
  const next = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, m.campaignId))
    .limit(1);
  return json(next[0]);
};

export const _openapi = {
  GET: {
    summary: 'Fetch a campaign by its shareable code',
    description:
      'Unauthenticated by design so the join page can preview the campaign name; anonymous lookups are rate limited.',
    params: Params,
    response: Campaign,
    public: true,
    errors: [404, { status: 429, description: 'Too many anonymous lookups' }]
  },
  PATCH: {
    summary: 'Rename a campaign (DM only)',
    params: Params,
    body: UpdateCampaignRequest,
    response: Campaign,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
