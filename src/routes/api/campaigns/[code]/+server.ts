import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, UpdateCampaignRequest } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const GET: RequestHandler = async ({ params }) => {
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
  if (!locals.user) throw error(401, 'login required');
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  // DM-only — players can't rename a campaign they joined.
  const m = await requireMembershipByCode(locals.user, code);
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

export const openapi = {
  GET: { summary: 'Fetch a campaign by its shareable code' },
  PATCH: { summary: 'Rename a campaign (DM only)', body: UpdateCampaignRequest }
} as const;
