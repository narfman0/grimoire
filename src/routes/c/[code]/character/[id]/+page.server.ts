import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies }) => {
  const code = params.code.toUpperCase();
  const displayName = cookies.get('grimoire_name');
  if (!displayName) throw redirect(303, '/');

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
  const campaign = campaignRows[0];

  const characterRows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      name: schema.characters.name,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(and(eq(schema.characters.id, params.id), eq(schema.characters.campaignId, campaign.id)))
    .limit(1);
  if (characterRows.length === 0) throw error(404, 'character not found in this campaign');
  const character = characterRows[0];

  if (!character.document) {
    return {
      campaign,
      character: {
        id: character.id,
        name: character.name,
        updatedAt: character.updatedAt.getTime()
      },
      document: null,
      derived: null,
      displayName
    };
  }

  const document = JSON.parse(character.document) as CharacterDocument;
  const { lookup } = await buildContentLookup();
  const derived = derive(document, lookup);

  return {
    campaign,
    character: {
      id: character.id,
      name: character.name,
      updatedAt: character.updatedAt.getTime()
    },
    document,
    derived: serializeDerived(derived),
    displayName
  };
};
