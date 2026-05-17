import { redirect } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { PageServerLoad } from './$types';

const sources = [...PUBLIC_SOURCES];

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
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.campaignId, campaignRows[0].id));

  // Pickers in the creation form: list all globally-loaded species + classes
  // (SRD + grimoire-packs). pack_slug isn't filtered here — the campaign
  // owner can pick from any loaded pack until per-campaign enablement lands.
  const speciesRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'species'));

  const classRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'class'));

  const backgroundRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'background'));

  const subclassRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'subclass'));

  return {
    campaign: campaignRows[0],
    displayName,
    characters: characterRows.map((r) => ({
      id: r.id,
      campaignId: r.campaignId,
      name: r.name,
      hasDocument: r.document != null,
      updatedAt: r.updatedAt.getTime()
    })),
    speciesOptions: speciesRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      source: r.source
    })),
    classOptions: classRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      source: r.source,
      hitDie: (JSON.parse(r.data as string) as { hitDie?: number }).hitDie ?? 8
    })),
    backgroundOptions: backgroundRows.map((r) => {
      const data = JSON.parse(r.data as string) as {
        abilityChoices?: string[];
        skillProficiencies?: string[];
      };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        abilityChoices: data.abilityChoices ?? [],
        skillProficiencies: data.skillProficiencies ?? []
      };
    }),
    subclassOptions: subclassRows.map((r) => {
      const data = JSON.parse(r.data as string) as { parentClass?: string };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        parentClass: data.parentClass ?? ''
      };
    })
  };
};
