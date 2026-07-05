import { redirect } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { CharacterDocument } from '$lib/rules/types';
import type { PageServerLoad } from './$types';

type SpeciesOption = { slug: string; name: string; source: string };
type ClassOption = { slug: string; name: string; source: string; hitDie: number };
type SubclassOption = { slug: string; name: string; source: string; parentClass: string };

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  // List campaigns this user is a member of, with role.
  const memberships = await db
    .select({
      campaignId: schema.campaignMembers.campaignId,
      role: schema.campaignMembers.role,
      joinedAt: schema.campaignMembers.joinedAt
    })
    .from(schema.campaignMembers)
    .where(eq(schema.campaignMembers.userId, locals.user.id));

  let campaigns: Array<{
    id: string;
    code: string;
    name: string;
    role: string;
    joinedAt: number;
    characterCount: number;
    encounterCount: number;
  }> = [];
  if (memberships.length > 0) {
    const ids = memberships.map((m) => m.campaignId);

    const rows = await db
      .select({
        id: schema.campaigns.id,
        code: schema.campaigns.code,
        name: schema.campaigns.name
      })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.id, ids));

    // Per-campaign character + encounter counts in one round-trip each.
    // Counts surface in the home-page list so the user can pick up where
    // the most action lives at a glance.
    const charCounts = await db
      .select({
        campaignId: schema.characters.campaignId,
        count: sql<number>`count(*)`
      })
      .from(schema.characters)
      .where(inArray(schema.characters.campaignId, ids))
      .groupBy(schema.characters.campaignId);
    const encCounts = await db
      .select({
        campaignId: schema.encounters.campaignId,
        count: sql<number>`count(*)`
      })
      .from(schema.encounters)
      .where(inArray(schema.encounters.campaignId, ids))
      .groupBy(schema.encounters.campaignId);

    const byId = new Map(rows.map((r) => [r.id, r]));
    const charByCampaign = new Map(charCounts.map((c) => [c.campaignId, Number(c.count)]));
    const encByCampaign = new Map(encCounts.map((c) => [c.campaignId, Number(c.count)]));
    campaigns = memberships
      .map((m) => {
        const c = byId.get(m.campaignId);
        if (!c) return null;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          role: m.role,
          joinedAt: m.joinedAt.getTime(),
          characterCount: charByCampaign.get(c.id) ?? 0,
          encounterCount: encByCampaign.get(c.id) ?? 0
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null)
      .sort((a, b) => b.joinedAt - a.joinedAt);
  }

  // User-owned characters (across all campaigns, including unlinked /
  // retired). Mirrored from /characters/+page.server.ts so the home hub
  // shows characters as content, not just a link.
  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      slug: schema.characters.slug,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.ownerUserId, locals.user.id))
    .orderBy(desc(schema.characters.updatedAt));

  const charIds = charRows.map((c) => c.id);
  const links = charIds.length
    ? await db
        .select({
          characterId: schema.campaignCharacters.characterId,
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

  const characters = charRows.map((c) => {
    let descLine = '';
    let totalLevel = 0;
    let portrait: string | undefined;
    if (c.document) {
      try {
        const doc = JSON.parse(c.document) as CharacterDocument;
        const cls = doc.classes
          .map((k) => `${k.slug}${k.subclass ? ` (${k.subclass})` : ''} ${k.level}`)
          .join(', ');
        descLine = `${doc.species?.slug ?? 'unknown'} — ${cls}`;
        totalLevel = doc.classes.reduce((s, k) => s + k.level, 0);
        portrait = doc.portrait;
      } catch {
        // ignore
      }
    }
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      ownerUsername: locals.user!.username,
      descLine,
      totalLevel,
      portrait,
      campaigns: linksByChar.get(c.id) ?? []
    };
  });

  const speciesRows = await db
    .select({ slug: schema.content.slug, name: schema.content.name, source: schema.content.source })
    .from(schema.content)
    .where(eq(schema.content.kind, 'species'));

  const classRows = await db
    .select({ slug: schema.content.slug, name: schema.content.name, source: schema.content.source, data: schema.content.data })
    .from(schema.content)
    .where(eq(schema.content.kind, 'class'));

  const subclassRows = await db
    .select({ slug: schema.content.slug, name: schema.content.name, source: schema.content.source, data: schema.content.data })
    .from(schema.content)
    .where(eq(schema.content.kind, 'subclass'));

  const speciesOptions: SpeciesOption[] = speciesRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    source: r.source
  }));

  const classOptions: ClassOption[] = classRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    source: r.source,
    hitDie: (JSON.parse(r.data as string) as { hitDie?: number }).hitDie ?? 8
  }));

  const subclassOptions: SubclassOption[] = subclassRows.map((r) => {
    const data = JSON.parse(r.data as string) as { parentClass?: string };
    return { slug: r.slug, name: r.name, source: r.source, parentClass: data.parentClass ?? '' };
  });

  return {
    user: locals.user,
    campaigns,
    characters,
    speciesOptions,
    classOptions,
    subclassOptions
  };
};
