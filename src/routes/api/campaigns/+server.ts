import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { generateCampaignCode } from '$lib/server/code';
import { CreateCampaignRequest } from '$lib/server/api/schemas';
import { parseJson } from '$lib/server/api/validate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const { name } = await parseJson(request, CreateCampaignRequest);

  const id = crypto.randomUUID();

  // Re-roll on the astronomically unlikely chance of a collision.
  let code = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateCampaignCode();
    const hit = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.code, candidate))
      .limit(1);
    if (hit.length === 0) {
      code = candidate;
      break;
    }
  }
  if (!code) throw error(500, 'could not allocate campaign code');

  await db.insert(schema.campaigns).values({
    id,
    code,
    name,
    createdAt: new Date()
  });

  return json({ id, code });
};
