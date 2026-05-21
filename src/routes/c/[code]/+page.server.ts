import { redirect } from '@sveltejs/kit';
import { and, eq, inArray, ne } from 'drizzle-orm';
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

  // Characters linked to this campaign via the M:N join table. Post-Phase 1
  // a character can be linked to N campaigns; the JOIN replaces the old
  // direct .where(characters.campaignId = ...) scan.
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
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(eq(schema.campaignCharacters.campaignId, membership.campaignId));

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

  const noteRows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.campaignId, campaign.id));

  // Content grants (DM-managed): which packs and authors are enabled for this campaign.
  const grantRows = await db
    .select()
    .from(schema.campaignContentGrants)
    .where(eq(schema.campaignContentGrants.campaignId, campaign.id));

  // All real packs (exclude synthetic 'homebrew' pack).
  const availablePackRows = await db
    .select({ slug: schema.packs.slug, name: schema.packs.name })
    .from(schema.packs)
    .where(ne(schema.packs.slug, 'homebrew'));

  // Resolve author user IDs → usernames.
  const grantedAuthorIds = grantRows
    .filter((g) => g.grantType === 'author')
    .map((g) => g.grantKey);
  const authorUsernameMap = new Map<string, string>();
  if (grantedAuthorIds.length > 0) {
    const authorUsers = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.id, grantedAuthorIds));
    for (const u of authorUsers) authorUsernameMap.set(u.id, u.username);
  }

  // Phase 4: list of user-owned characters that AREN'T already linked to
  // this campaign — feeds the "+ link existing" picker. Subquery filter:
  // owned by current user, id not in this campaign's join rows.
  const linkedIdsRows = await db
    .select({ id: schema.campaignCharacters.characterId })
    .from(schema.campaignCharacters)
    .where(eq(schema.campaignCharacters.campaignId, membership.campaignId));
  const linkedIds = new Set(linkedIdsRows.map((r) => r.id));
  const myCharRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      document: schema.characters.document
    })
    .from(schema.characters)
    .where(eq(schema.characters.ownerUserId, locals.user.id));
  const linkableCharacters = myCharRows
    .filter((c) => !linkedIds.has(c.id))
    .map((c) => {
      let descLine = '';
      if (c.document) {
        try {
          const doc = JSON.parse(c.document) as {
            classes?: Array<{ slug?: string; level?: number }>;
            species?: { slug?: string };
          };
          const cls = (doc.classes ?? [])
            .map((k) => `${k.slug ?? '?'} ${k.level ?? '?'}`)
            .join(', ');
          descLine = `${doc.species?.slug ?? 'unknown'} — ${cls}`;
        } catch {
          // ignore
        }
      }
      return { id: c.id, name: c.name, descLine };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    campaign,
    user: locals.user,
    role: membership.role,
    grants: grantRows.map((g) => ({
      id: g.id,
      grantType: g.grantType as 'pack' | 'author',
      grantKey: g.grantKey,
      label: g.grantType === 'author' ? (authorUsernameMap.get(g.grantKey) ?? g.grantKey) : g.grantKey
    })),
    availablePacks: availablePackRows,
    notes: noteRows
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        updatedAt: n.updatedAt.getTime()
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    characters: characterRows.map((r) => ({
      id: r.id,
      campaignId: r.campaignId,
      ownerUserId: r.ownerUserId,
      name: r.name,
      hasDocument: r.document != null,
      updatedAt: r.updatedAt.getTime()
    })),
    linkableCharacters,
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
