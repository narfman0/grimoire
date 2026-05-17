import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, CreateCharacterRequest } from '$lib/server/api/schemas';
import { parseJson, parseSearch } from '$lib/server/api/validate';
import type { RequestHandler } from './$types';

const ListQuery = z.object({ campaign: CampaignCode.optional() });

export const GET: RequestHandler = async ({ url }) => {
  const { campaign } = parseSearch(url, ListQuery);

  if (campaign) {
    const found = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.code, campaign))
      .limit(1);
    if (found.length === 0) throw error(404, 'campaign not found');

    const rows = await db
      .select({
        id: schema.characters.id,
        campaignId: schema.characters.campaignId,
        name: schema.characters.name,
        updatedAt: schema.characters.updatedAt
      })
      .from(schema.characters)
      .where(eq(schema.characters.campaignId, found[0].id));

    return json({
      characters: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }))
    });
  }

  const rows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      name: schema.characters.name,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters);

  return json({
    characters: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }))
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const { campaignCode, name } = await parseJson(request, CreateCharacterRequest);

  const found = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, campaignCode))
    .limit(1);
  if (found.length === 0) throw error(404, 'campaign not found');

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.characters).values({
    id,
    campaignId: found[0].id,
    name,
    updatedAt: now
  });

  return json({
    id,
    campaignId: found[0].id,
    name,
    updatedAt: now.getTime()
  });
};
