import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
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
