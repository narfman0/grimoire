import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { PageServerLoad } from './$types';

const _publicSources = [...PUBLIC_SOURCES]; // referenced indirectly via content; pull-in keeps lint happy

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
  const campaign = campaignRows[0];

  const characterRows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      ownerUserId: schema.characters.ownerUserId,
      name: schema.characters.name,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.campaignId, membership.campaignId));

  // Pickers — same as before but auth-gated by membership above.
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
    campaign,
    user: locals.user,
    role: membership.role,
    characters: characterRows.map((r) => ({
      id: r.id,
      campaignId: r.campaignId,
      ownerUserId: r.ownerUserId,
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
