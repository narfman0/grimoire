import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { CampaignCode, Uuid } from '$lib/server/api/schemas';
import { OkResponse } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, id: Uuid });

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can manage content grants');

  const [grant] = await db
    .select({ id: schema.campaignContentGrants.id })
    .from(schema.campaignContentGrants)
    .where(
      and(
        eq(schema.campaignContentGrants.id, params.id),
        eq(schema.campaignContentGrants.campaignId, m.campaignId)
      )
    )
    .limit(1);
  if (!grant) throw error(404, 'grant not found');

  await db
    .delete(schema.campaignContentGrants)
    .where(eq(schema.campaignContentGrants.id, params.id));

  return json({ ok: true });
};

export const _openapi = {
  DELETE: {
    summary: 'Remove a content grant from a campaign (DM only)',
    params: Params,
    response: OkResponse,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
