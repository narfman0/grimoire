// /homebrew/author/[username] — author profile listing every public +
// unlisted row they've published. Private rows visible only to the author
// themselves.

import { error, redirect } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

  const [author] = await db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.username, params.username))
    .limit(1);
  if (!author) throw error(404, 'author not found');

  const isOwner = author.id === locals.user.id;
  const visibilities = isOwner ? ['public', 'unlisted', 'private'] : ['public', 'unlisted'];

  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      name: schema.content.name,
      visibility: schema.content.visibility,
      data: schema.content.data,
      createdAt: schema.content.createdAt
    })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.ownerUserId, author.id),
        inArray(schema.content.visibility, visibilities)
      )
    );

  const items = rows
    .map((r) => {
      const data = JSON.parse(r.data as string) as { category?: string; description?: string };
      return {
        kind: r.kind,
        slug: r.slug,
        name: r.name,
        visibility: r.visibility,
        category: data.category ?? '',
        description: (data.description ?? '').slice(0, 160),
        createdAt: r.createdAt.getTime()
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  // Per-kind counts for the header summary.
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;

  return {
    author,
    isOwner,
    items,
    counts
  };
};
