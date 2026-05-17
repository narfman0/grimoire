import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const code = params.code.toUpperCase();
  const campaignRows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);

  if (campaignRows.length === 0) throw redirect(303, '/');

  const displayName = cookies.get('grimoire_name');
  if (!displayName) throw redirect(303, '/');

  const characterRows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      name: schema.characters.name,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.campaignId, campaignRows[0].id));

  return {
    campaign: campaignRows[0],
    displayName,
    characters: characterRows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }))
  };
};
