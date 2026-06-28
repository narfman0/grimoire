import { redirect, error } from '@sveltejs/kit';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import {
  getMembershipWithStatus,
  resolveCampaignByDmAndSlug
} from '$lib/server/auth/membership';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { PageServerLoad } from './$types';

const _publicSources = [...PUBLIC_SOURCES]; // referenced indirectly via content; pull-in keeps lint happy

const EMPTY_PAGE = {
  grants: [] as { id: string; grantType: 'pack' | 'author'; grantKey: string; label: string }[],
  availablePacks: [] as { slug: string; name: string }[],
  campaignMembers: [] as { id: string; username: string }[],
  notes: [] as { id: string; title: string; body: string; updatedAt: number }[],
  characters: [] as { id: string; campaignId: string | null; ownerUserId: string | null; ownerUsername: string | null; slug: string | null; name: string; hasDocument: boolean; descLine: string; totalLevel: number; updatedAt: number }[],
  linkableCharacters: [] as { id: string; name: string; descLine: string }[],
  speciesOptions: [] as { slug: string; name: string; source: string }[],
  classOptions: [] as { slug: string; name: string; source: string; hitDie: number }[],
  backgroundOptions: [] as { slug: string; name: string; source: string; abilityChoices: string[]; skillProficiencies: string[] }[],
  subclassOptions: [] as { slug: string; name: string; source: string; parentClass: string }[],
  pendingMembers: [] as { userId: string; username: string; requestedAt: number }[],
};

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  // Resolve /campaigns/<dmUsername>/<slug> → the underlying campaign (still
  // keyed by code/UUID for membership + APIs).
  const resolved = await resolveCampaignByDmAndSlug(params.dmUsername, params.slug);
  if (!resolved) throw error(404, 'campaign not found');
  const code = resolved.code;
  const campaign = {
    id: resolved.id,
    code: resolved.code,
    name: resolved.name,
    slug: resolved.slug,
    dmUsername: params.dmUsername
  };

  const membership = await getMembershipWithStatus(locals.user.id, code);
  if (!membership) throw error(403, 'not a member of this campaign');

  // Pending/rejected members see a status page instead of the campaign content.
  if (membership.status === 'pending' || membership.status === 'rejected') {
    return {
      pending: membership.status === 'pending',
      rejected: membership.status === 'rejected',
      campaign,
      user: locals.user,
      role: 'player' as const,
      ...EMPTY_PAGE,
    };
  }

  // Characters linked to this campaign via the M:N join table. Post-Phase 1
  // a character can be linked to N campaigns; the JOIN replaces the old
  // direct .where(characters.campaignId = ...) scan. leftJoin users so
  // legacy NULL-owner characters still list (they just have no sheet URL).
  const characterRows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      ownerUserId: schema.characters.ownerUserId,
      ownerUsername: schema.users.username,
      slug: schema.characters.slug,
      name: schema.characters.name,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.characters.ownerUserId))
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

  // All approved campaign members with usernames — feeds both the author grant
  // dropdown and the username resolution for existing grants.
  const memberUserRows = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.campaignMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.campaignMembers.userId))
    .where(
      and(
        eq(schema.campaignMembers.campaignId, campaign.id),
        eq(schema.campaignMembers.status, 'approved')
      )
    );

  // Pending join requests — shown to DM only.
  const pendingMemberRows =
    membership.role === 'dm'
      ? await db
          .select({
            userId: schema.campaignMembers.userId,
            username: schema.users.username,
            requestedAt: schema.campaignMembers.joinedAt
          })
          .from(schema.campaignMembers)
          .innerJoin(schema.users, eq(schema.users.id, schema.campaignMembers.userId))
          .where(
            and(
              eq(schema.campaignMembers.campaignId, campaign.id),
              eq(schema.campaignMembers.status, 'pending')
            )
          )
      : [];

  const authorUsernameMap = new Map(memberUserRows.map((u) => [u.id, u.username]));
  // Also resolve any granted authors who may no longer be members.
  const grantedAuthorIds = grantRows
    .filter((g) => g.grantType === 'author' && !authorUsernameMap.has(g.grantKey))
    .map((g) => g.grantKey);
  if (grantedAuthorIds.length > 0) {
    const extra = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.id, grantedAuthorIds));
    for (const u of extra) authorUsernameMap.set(u.id, u.username);
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
    pending: false,
    rejected: false,
    campaign,
    user: locals.user,
    role: membership.role,
    pendingMembers: pendingMemberRows.map((r) => ({
      userId: r.userId,
      username: r.username,
      requestedAt: r.requestedAt.getTime()
    })),
    grants: grantRows.map((g) => ({
      id: g.id,
      grantType: g.grantType as 'pack' | 'author',
      grantKey: g.grantKey,
      label: g.grantType === 'author' ? (authorUsernameMap.get(g.grantKey) ?? g.grantKey) : g.grantKey
    })),
    availablePacks: availablePackRows,
    campaignMembers: memberUserRows,
    notes: noteRows
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        updatedAt: n.updatedAt.getTime()
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    characters: characterRows.map((r) => {
      let descLine = '';
      let totalLevel = 0;
      if (r.document) {
        try {
          const doc = JSON.parse(r.document) as {
            classes?: Array<{ slug?: string; level?: number; subclass?: string }>;
            species?: { slug?: string };
          };
          const cls = (doc.classes ?? [])
            .map((k) => `${k.slug ?? '?'}${k.subclass ? ` (${k.subclass})` : ''} ${k.level ?? '?'}`)
            .join(', ');
          descLine = `${doc.species?.slug ?? 'unknown'} — ${cls}`;
          totalLevel = (doc.classes ?? []).reduce((s, k) => s + (k.level ?? 0), 0);
        } catch {
          // ignore
        }
      }
      return {
        id: r.id,
        campaignId: r.campaignId,
        ownerUserId: r.ownerUserId,
        ownerUsername: r.ownerUsername,
        slug: r.slug,
        name: r.name,
        hasDocument: r.document != null,
        descLine,
        totalLevel,
        updatedAt: r.updatedAt.getTime()
      };
    }),
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
