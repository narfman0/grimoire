// /me/homebrew/subscriptions — list of homebrew rows the current user
// subscribes to. Joins to users (author) + content (current name +
// visibility, NULL when the author has deleted the row).
//
// Versioning: each subscription carries a `pinnedVersion`. When the author
// has published a higher version, surface an "Update available" hint so the
// subscriber can upgrade explicitly.

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;

  // Latest published version per (kind, slug, owner). Subselected so we can
  // surface "Update available" hints in the UI in a single query.
  const latestPublished = db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      ownerUserId: schema.content.ownerUserId,
      latestVersion: sql<number>`max(${schema.content.version})`.as('latest_version')
    })
    .from(schema.content)
    .where(isNotNull(schema.content.publishedAt))
    .groupBy(schema.content.kind, schema.content.slug, schema.content.ownerUserId)
    .as('latest_published');

  const rows = await db
    .select({
      kind: schema.homebrewSubscriptions.contentKind,
      slug: schema.homebrewSubscriptions.contentSlug,
      authorUserId: schema.homebrewSubscriptions.authorUserId,
      pinnedVersion: schema.homebrewSubscriptions.pinnedVersion,
      createdAt: schema.homebrewSubscriptions.createdAt,
      authorUsername: schema.users.username,
      contentName: schema.content.name,
      contentVisibility: schema.content.visibility,
      latestPublishedVersion: latestPublished.latestVersion
    })
    .from(schema.homebrewSubscriptions)
    .innerJoin(schema.users, eq(schema.users.id, schema.homebrewSubscriptions.authorUserId))
    .leftJoin(
      schema.content,
      and(
        eq(schema.content.kind, schema.homebrewSubscriptions.contentKind),
        eq(schema.content.slug, schema.homebrewSubscriptions.contentSlug),
        eq(schema.content.ownerUserId, schema.homebrewSubscriptions.authorUserId)
      )
    )
    .leftJoin(
      latestPublished,
      and(
        eq(latestPublished.kind, schema.homebrewSubscriptions.contentKind),
        eq(latestPublished.slug, schema.homebrewSubscriptions.contentSlug),
        eq(latestPublished.ownerUserId, schema.homebrewSubscriptions.authorUserId)
      )
    )
    .where(eq(schema.homebrewSubscriptions.userId, userId));

  // Dedup: the content leftJoin can produce one row per content version.
  // Prefer the row that has a content name (drops the orphan dupe).
  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.kind} ${r.slug} ${r.authorUserId}`;
    const prior = seen.get(k);
    if (!prior || (r.contentName !== null && prior.contentName === null)) seen.set(k, r);
  }

  const subscriptions = Array.from(seen.values())
    .map((r) => ({
      kind: r.kind,
      slug: r.slug,
      authorUserId: r.authorUserId,
      authorUsername: r.authorUsername,
      contentName: r.contentName,
      visibility: r.contentVisibility,
      pinnedVersion: r.pinnedVersion,
      latestPublishedVersion: r.latestPublishedVersion ?? null,
      createdAt: r.createdAt.getTime(),
      orphaned: r.contentName === null,
      updateAvailable:
        r.latestPublishedVersion !== null &&
        r.pinnedVersion !== null &&
        r.latestPublishedVersion > r.pinnedVersion
    }))
    .sort((a, b) => Number(b.updateAvailable) - Number(a.updateAvailable) || b.createdAt - a.createdAt);

  return { subscriptions };
};
