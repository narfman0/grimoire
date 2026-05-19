import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { subscribe } from '$lib/server/realtime/hub';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

export const GET: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);

  const rows = await db
    .select({ campaignId: schema.characters.campaignId })
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1);
  const char = rows[0];
  if (!char) throw error(404, 'character not found');
  const role = await getMembershipByCampaignId(locals.user.id, char.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');

  const stream = subscribe(`character:${id}`, request.signal);
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive'
    }
  });
};
