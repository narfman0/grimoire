import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { buildCharacterPageData } from '$lib/server/character-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const membership = await requireMembershipByCode(locals.user, code);

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

  // Post-Phase 1: a character "belongs to" this campaign iff there's a
  // campaign_characters row pairing them. JOIN through that to enforce
  // the URL's campaign code matches a link the character actually has.
  const characterRows = await db
    .select({
      id: schema.characters.id,
      ownerUserId: schema.characters.ownerUserId,
      name: schema.characters.name,
      slug: schema.characters.slug,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(
      and(
        eq(schema.characters.id, params.id),
        eq(schema.campaignCharacters.campaignId, campaign.id)
      )
    )
    .limit(1);
  if (characterRows.length === 0) throw error(404, 'character not found in this campaign');
  const character = characterRows[0];

  const { data } = await buildCharacterPageData(character, {
    kind: 'campaign',
    campaignId: campaign.id,
    isDM: membership.role === 'dm'
  });

  return {
    campaign,
    user: locals.user,
    role: membership.role,
    ...data
  };
};
