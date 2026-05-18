// Character library — all characters owned by the current user, with
// badges showing which campaigns each is linked to via campaign_characters.
// Independent of any specific campaign context.

import { redirect } from '@sveltejs/kit';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { CharacterDocument } from '$lib/rules/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      campaignId: schema.characters.campaignId,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.ownerUserId, locals.user.id))
    .orderBy(desc(schema.characters.updatedAt));

  // For each character, surface the campaigns it's linked to via the
  // M:N join table. Empty array = "retired / not in any campaign yet."
  const charIds = charRows.map((c) => c.id);
  const links = charIds.length
    ? await db
        .select({
          characterId: schema.campaignCharacters.characterId,
          campaignId: schema.campaignCharacters.campaignId,
          campaignCode: schema.campaigns.code,
          campaignName: schema.campaigns.name
        })
        .from(schema.campaignCharacters)
        .innerJoin(
          schema.campaigns,
          eq(schema.campaigns.id, schema.campaignCharacters.campaignId)
        )
        .where(inArray(schema.campaignCharacters.characterId, charIds))
    : [];
  const linksByChar = new Map<string, Array<{ code: string; name: string }>>();
  for (const l of links) {
    const arr = linksByChar.get(l.characterId) ?? [];
    arr.push({ code: l.campaignCode, name: l.campaignName });
    linksByChar.set(l.characterId, arr);
  }

  function describe(doc: CharacterDocument): string {
    const cls = doc.classes
      .map((c) => `${c.slug}${c.subclass ? ` (${c.subclass})` : ''} ${c.level}`)
      .join(', ');
    const species = doc.species?.slug ?? 'unknown';
    return `${species} — ${cls}`;
  }

  return {
    user: locals.user,
    characters: charRows.map((c) => {
      let descLine = '';
      let totalLevel = 0;
      if (c.document) {
        try {
          const doc = JSON.parse(c.document) as CharacterDocument;
          descLine = describe(doc);
          totalLevel = doc.classes.reduce((s, k) => s + k.level, 0);
        } catch {
          // ignore — leave fields blank
        }
      }
      return {
        id: c.id,
        name: c.name,
        homeCampaignId: c.campaignId,
        descLine,
        totalLevel,
        updatedAt: c.updatedAt.getTime(),
        campaigns: linksByChar.get(c.id) ?? []
      };
    })
  };
};
