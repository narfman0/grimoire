// /homebrew/browse — public marketplace index. Only `visibility='public'`
// rows surface here; unlisted rows are reachable via direct URL only.
// Auth: logged-in users only. Anonymous visitors are bounced to /login.

import { redirect } from '@sveltejs/kit';
import { and, eq, like, desc, asc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 30;

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

  const kind = url.searchParams.get('kind') ?? '';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const sort = (url.searchParams.get('sort') ?? 'newest') as 'newest' | 'name' | 'subscribed';
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);

  const clauses = [
    eq(schema.content.source, 'homebrew'),
    eq(schema.content.visibility, 'public')
  ];
  if (kind && HOMEBREW_KINDS.includes(kind as (typeof HOMEBREW_KINDS)[number])) {
    clauses.push(eq(schema.content.kind, kind));
  }
  if (q) clauses.push(like(schema.content.name, `%${q}%`));
  const where = and(...clauses);

  const orderBy =
    sort === 'name'
      ? [asc(schema.content.name)]
      : sort === 'subscribed'
        ? [desc(schema.content.createdAt)] // sub count handled below post-query
        : [desc(schema.content.createdAt)];

  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      name: schema.content.name,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId,
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

  // Author usernames + subscriber counts in two batched queries (avoids the
  // N+1 trap on a 30-row page).
  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId).filter((x): x is string => !!x))];
  const userRows =
    ownerIds.length > 0
      ? await db
          .select({ id: schema.users.id, username: schema.users.username })
          .from(schema.users)
          .where(inArray(schema.users.id, ownerIds))
      : [];
  const usernameById = new Map(userRows.map((u) => [u.id, u.username]));

  const subKeys = rows.map((r) => `${r.kind}|${r.slug}|${r.ownerUserId}`);
  // Subscriber counts grouped by (kind, slug, author) — only for the rows
  // on this page. Done as a single grouped query.
  const subCounts = new Map<string, number>();
  if (rows.length > 0) {
    const counts = await db
      .select({
        kind: schema.homebrewSubscriptions.contentKind,
        slug: schema.homebrewSubscriptions.contentSlug,
        author: schema.homebrewSubscriptions.authorUserId,
        c: sql<number>`count(*)`
      })
      .from(schema.homebrewSubscriptions)
      .where(
        inArray(
          schema.homebrewSubscriptions.authorUserId,
          ownerIds.length > 0 ? ownerIds : ['__none__']
        )
      )
      .groupBy(
        schema.homebrewSubscriptions.contentKind,
        schema.homebrewSubscriptions.contentSlug,
        schema.homebrewSubscriptions.authorUserId
      );
    for (const c of counts) subCounts.set(`${c.kind}|${c.slug}|${c.author}`, c.c);
  }

  // Subscriptions the current viewer already has, so the card can show "Subscribed".
  const mySubs = await db
    .select({
      kind: schema.homebrewSubscriptions.contentKind,
      slug: schema.homebrewSubscriptions.contentSlug,
      author: schema.homebrewSubscriptions.authorUserId
    })
    .from(schema.homebrewSubscriptions)
    .where(eq(schema.homebrewSubscriptions.userId, locals.user.id));
  const subscribedKeys = new Set(mySubs.map((s) => `${s.kind}|${s.slug}|${s.author}`));

  const items = rows
    .map((r, idx) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        description?: string;
        prerequisite?: string;
      };
      const key = subKeys[idx];
      return {
        kind: r.kind,
        slug: r.slug,
        name: r.name,
        description: (data.description ?? '').slice(0, 240),
        category: data.category ?? '',
        prerequisite: data.prerequisite ?? '',
        authorUserId: r.ownerUserId,
        authorUsername: r.ownerUserId ? usernameById.get(r.ownerUserId) ?? null : null,
        subscriberCount: subCounts.get(key) ?? 0,
        viewerSubscribed: subscribedKeys.has(key),
        createdAt: r.createdAt.getTime()
      };
    })
    // 'subscribed' sort handled here post-fetch since SQLite can't sort by
    // a per-row subquery cheaply with drizzle's pagination shape.
    .sort((a, b) => {
      if (sort === 'subscribed') return b.subscriberCount - a.subscriberCount;
      return 0;
    });

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    filter: { kind, q, sort },
    kinds: HOMEBREW_KINDS
  };
};
