import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, JoinCampaignRequest } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const POST: RequestHandler = async ({ params, request, cookies }) => {
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const { displayName } = await parseJson(request, JoinCampaignRequest);

  const rows = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (rows.length === 0) throw error(404, 'campaign not found');

  cookies.set('grimoire_name', displayName, {
    path: '/',
    httpOnly: false, // client may want to display "you are: X"
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30
  });

  return new Response(null, { status: 204 });
};
