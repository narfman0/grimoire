import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);

  const rows = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  if (rows.length === 0) throw error(404, 'campaign not found');
  const campaignId = rows[0].id;

  const existing = await db
    .select({ role: schema.campaignMembers.role, status: schema.campaignMembers.status })
    .from(schema.campaignMembers)
    .where(
      and(
        eq(schema.campaignMembers.campaignId, campaignId),
        eq(schema.campaignMembers.userId, locals.user.id)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.campaignMembers).values({
      campaignId,
      userId: locals.user.id,
      role: 'player',
      status: 'pending',
      joinedAt: new Date()
    });
    return json({ campaignId, status: 'pending' });
  }

  // Allow re-application after rejection; approved/pending are idempotent.
  if (existing[0].status === 'rejected') {
    await db
      .update(schema.campaignMembers)
      .set({ status: 'pending', joinedAt: new Date() })
      .where(
        and(
          eq(schema.campaignMembers.campaignId, campaignId),
          eq(schema.campaignMembers.userId, locals.user.id)
        )
      );
    return json({ campaignId, status: 'pending' });
  }

  return json({ campaignId, status: existing[0].status });
};

export const _openapi = {
  POST: { summary: 'Join a campaign as a player' }
} as const;
