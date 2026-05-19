// /content/browse/[author]/[kind]/[slug] — detail page for homebrew rows.
// Pack rows live at /content/browse/pack/[packSlug]/[kind]/[slug] since they
// have no author. URL slot 1 is the author username (resolved to user_id)
// so slug collisions across authors disambiguate naturally. Visibility:
//   - 'public': anyone logged in sees it.
//   - 'unlisted': anyone with the URL sees it (404 if visibility='private').
//   - 'private': only the owner sees it; everyone else 404.

import { error, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

  const [author] = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.username, params.author))
    .limit(1);
  if (!author) throw error(404, 'author not found');

  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, params.kind),
        eq(schema.content.slug, params.slug),
        eq(schema.content.ownerUserId, author.id)
      )
    )
    .limit(1);
  if (!row) throw error(404, 'not found');

  const isOwner = row.ownerUserId === locals.user.id;
  if (!isOwner && row.visibility === 'private') throw error(404, 'not found');

  const [count] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.homebrewSubscriptions)
    .where(
      and(
        eq(schema.homebrewSubscriptions.contentKind, row.kind),
        eq(schema.homebrewSubscriptions.contentSlug, row.slug),
        eq(schema.homebrewSubscriptions.authorUserId, author.id)
      )
    );
  const [mine] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.homebrewSubscriptions)
    .where(
      and(
        eq(schema.homebrewSubscriptions.userId, locals.user.id),
        eq(schema.homebrewSubscriptions.contentKind, row.kind),
        eq(schema.homebrewSubscriptions.contentSlug, row.slug),
        eq(schema.homebrewSubscriptions.authorUserId, author.id)
      )
    );

  return {
    isOwner,
    item: {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      name: row.name,
      visibility: row.visibility,
      authorUserId: author.id,
      authorUsername: author.username,
      source: row.source,
      packSlug: row.packSlug,
      data: JSON.parse(row.data as string),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt ? row.updatedAt.getTime() : null,
      subscriberCount: count?.c ?? 0,
      viewerSubscribed: (mine?.c ?? 0) > 0
    }
  };
};
