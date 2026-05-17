import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import { requireMembershipByCode } from '$lib/server/auth/membership';
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
      user: locals.user,
      role: membership.role,
      character: {
        id: character.id,
        name: character.name,
        updatedAt: character.updatedAt.getTime()
      },
      document: null,
      derived: null
    };
  }

  const document = JSON.parse(character.document) as CharacterDocument;
  const { lookup } = await buildContentLookup();
  const derived = derive(document, lookup);

  // Item picker options for the inventory section.
  const itemRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'item'));

  const itemOptions = itemRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        weaponType?: string;
        armorType?: string;
        requiresAttunement?: boolean | object;
      };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        category: data.category ?? 'other',
        kindHint: data.weaponType ?? data.armorType ?? data.category ?? '',
        requiresAttunement: data.requiresAttunement === true
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const spellRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'spell'));

  const spellOptions = spellRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as { level?: number; school?: string };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        level: data.level ?? 0,
        school: data.school ?? ''
      };
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const subclassRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'subclass'));

  const subclassOptions = subclassRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as { parentClass?: string };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        parentClass: data.parentClass ?? ''
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Background options for the retroactive picker affordance on the sheet
  // (creation form deliberately doesn't ask for these; user picks here).
  const backgroundRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'background'));

  const backgroundOptions = backgroundRows
    .map((r) => {
      const d = JSON.parse(r.data as string) as { abilityChoices?: string[] };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        abilityChoices: d.abilityChoices ?? []
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    campaign,
    user: locals.user,
    role: membership.role,
    character: {
      id: character.id,
      name: character.name,
      updatedAt: character.updatedAt.getTime()
    },
    document,
    derived: serializeDerived(derived),
    itemOptions,
    spellOptions,
    subclassOptions,
    backgroundOptions
  };
};
