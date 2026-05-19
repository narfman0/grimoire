// /content/browse — content marketplace. Surfaces every `visibility='public'`,
// published row across packs AND homebrew, with filters by kind, source
// (pack slug or 'homebrew'), edition (joined from packs), and free-text name.
// Edition awareness lets a 5e DM hide 5.5e content without parsing slugs.
// Auth: logged-in users only.

import { redirect } from '@sveltejs/kit';
import { and, eq, like, desc, asc, sql, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 30;

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  const kind = url.searchParams.get('kind') ?? '';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const source = url.searchParams.get('source') ?? '';   // pack slug or 'homebrew'
  const edition = url.searchParams.get('edition') ?? ''; // '5e', '5.5e', …
  const sort = (url.searchParams.get('sort') ?? 'newest') as 'newest' | 'name' | 'subscribed';
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);

  // Editions / sources surface in the filter dropdowns regardless of the
  // current filter so the user can switch back. Pulled from a small fast
  // pre-query on the packs table.
  const packRows = await db
    .select({ slug: schema.packs.slug, name: schema.packs.name, edition: schema.packs.edition })
    .from(schema.packs);
  const packs = packRows.map((p) => ({ slug: p.slug, name: p.name, edition: p.edition }));
  const editions = [...new Set(packRows.map((p) => p.edition).filter((e): e is string => !!e))].sort();
  const sources = ['homebrew', ...packs.map((p) => p.slug)];

  // Edition filter → list of pack slugs whose edition matches. We can then
  // restrict the content table to source IN (those packs) — homebrew rows
  // have no edition concept yet so they drop out when an edition is selected.
  const editionPackSlugs = edition
    ? packs.filter((p) => p.edition === edition).map((p) => p.slug)
    : null;

  const clauses = [eq(schema.content.visibility, 'public'), isNotNull(schema.content.publishedAt)];
  if (kind && HOMEBREW_KINDS.includes(kind as (typeof HOMEBREW_KINDS)[number])) {
    clauses.push(eq(schema.content.kind, kind));
  }
  if (q) clauses.push(like(schema.content.name, `%${q}%`));
  if (source === 'homebrew') {
    clauses.push(eq(schema.content.source, 'homebrew'));
  } else if (source) {
    clauses.push(eq(schema.content.source, source));
  }
  if (editionPackSlugs) {
    // Restrict to rows whose source matches one of this edition's pack slugs.
    if (editionPackSlugs.length === 0) {
      // No packs declare this edition → empty result; force false.
      clauses.push(sql`0 = 1`);
    } else {
      clauses.push(inArray(schema.content.source, editionPackSlugs));
    }
  }
  const where = and(...clauses);

  const orderBy =
    sort === 'name'
      ? [asc(schema.content.name)]
      : [desc(schema.content.createdAt)]; // 'subscribed' sorted post-fetch

  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      name: schema.content.name,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId,
      source: schema.content.source,
      packSlug: schema.content.packSlug,
      createdAt: schema.content.createdAt
    })
    .from(schema.content)
    .where(where)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  const totalRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.content)
    .where(where);
  const total = totalRows[0]?.c ?? 0;

  // Author usernames for homebrew rows (pack rows skip this).
  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId).filter((x): x is string => !!x))];
  const userRows =
    ownerIds.length > 0
      ? await db
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(inArray(schema.users.id, ownerIds))
      : [];
  const usernameById = new Map(userRows.map((u) => [u.id, u.username]));

  // Subscriber counts for homebrew. Pack rows always show 0.
  const subKeys = rows.map((r) => (r.ownerUserId ? `${r.kind}|${r.slug}|${r.ownerUserId}` : null));
  const subCounts = new Map<string, number>();
  if (ownerIds.length > 0) {
    const counts = await db
      .select({
        kind: schema.homebrewSubscriptions.contentKind,
        slug: schema.homebrewSubscriptions.contentSlug,
        author: schema.homebrewSubscriptions.authorUserId,
        c: sql<number>`count(*)`
      })
      .from(schema.homebrewSubscriptions)
      .where(inArray(schema.homebrewSubscriptions.authorUserId, ownerIds))
      .groupBy(
        schema.homebrewSubscriptions.contentKind,
        schema.homebrewSubscriptions.contentSlug,
        schema.homebrewSubscriptions.authorUserId
      );
    for (const c of counts) subCounts.set(`${c.kind}|${c.slug}|${c.author}`, c.c);
  }

  const mySubs = await db
    .select({
      kind: schema.homebrewSubscriptions.contentKind,
      slug: schema.homebrewSubscriptions.contentSlug,
      author: schema.homebrewSubscriptions.authorUserId
    })
    .from(schema.homebrewSubscriptions)
    .where(eq(schema.homebrewSubscriptions.userId, locals.user.id));
  const subscribedKeys = new Set(mySubs.map((s) => `${s.kind}|${s.slug}|${s.author}`));

  const packEditionBySlug = new Map(packs.map((p) => [p.slug, p.edition ?? null]));

  const items = rows
    .map((r, idx) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        description?: string;
        prerequisite?: string;
        cr?: string | number;
      };
      const key = subKeys[idx];
      return {
        kind: r.kind,
        slug: r.slug,
        name: r.name,
        description: (data.description ?? '').slice(0, 240),
        category: data.category ?? '',
        prerequisite: data.prerequisite ?? '',
        cr: data.cr ?? null,
        source: r.source,
        packSlug: r.packSlug,
        edition: packEditionBySlug.get(r.packSlug) ?? null,
        authorUserId: r.ownerUserId,
        authorUsername: r.ownerUserId ? usernameById.get(r.ownerUserId) ?? null : null,
        subscriberCount: key ? subCounts.get(key) ?? 0 : 0,
        viewerSubscribed: key ? subscribedKeys.has(key) : false,
        createdAt: r.createdAt.getTime()
      };
    })
    .sort((a, b) => {
      if (sort === 'subscribed') return b.subscriberCount - a.subscriberCount;
      return 0;
    });

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    filter: { kind, q, sort, source, edition },
    kinds: HOMEBREW_KINDS,
    sources,
    editions,
    packs
  };
};
