import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, userId: Uuid });
const Body = z.object({ status: z.enum(['approved', 'rejected']) });

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { code, userId } = parseParams(
    { code: params.code?.toUpperCase(), userId: params.userId },
    Params
  );

  const m = await requireMembershipByCode(locals.user, code);
  if (m.role !== 'dm') throw error(403, 'DM only');

  const { status } = await parseJson(request, Body);

  const rows = await db
    .select({ status: schema.campaignMembers.status })
    .from(schema.campaignMembers)
    .where(
      and(
        eq(schema.campaignMembers.campaignId, m.campaignId),
        eq(schema.campaignMembers.userId, userId)
      )
    )
    .limit(1);

  if (rows.length === 0) throw error(404, 'member not found');
  if (rows[0].status !== 'pending') throw error(409, 'membership is not pending');

  await db
    .update(schema.campaignMembers)
    .set({ status })
    .where(
      and(
        eq(schema.campaignMembers.campaignId, m.campaignId),
        eq(schema.campaignMembers.userId, userId)
      )
    );

  return json({ status });
};

export const _openapi = {
  PATCH: { summary: 'Approve or reject a pending campaign join request (DM only)' }
} as const;
