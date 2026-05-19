// /content/browse/pack/[packSlug]/[kind]/[slug] — detail page for pack-loaded
// content (ownerUserId IS NULL). Resolves to the latest published version of
// the (kind, slug, packSlug) row. Anyone logged in can view: pack rows are
// always 'public' by backfill, and never carry the homebrew visibility logic.

import { error, redirect } from '@sveltejs/kit';
import { and, eq, desc, isNotNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

  const [pack] = await db
    .select({
      slug: schema.packs.slug,
      name: schema.packs.name,
      version: schema.packs.version,
      edition: schema.packs.edition,
      author: schema.packs.author
    })
    .from(schema.packs)
    .where(eq(schema.packs.slug, params.packSlug))
    .limit(1);
  if (!pack) throw error(404, 'pack not found');

  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, params.kind),
        eq(schema.content.slug, params.slug),
        eq(schema.content.packSlug, params.packSlug),
        isNotNull(schema.content.publishedAt)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  if (!row) throw error(404, 'not found');

  return {
    pack,
    item: {
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      name: row.name,
      source: row.source,
      packSlug: row.packSlug,
      version: row.version,
      data: JSON.parse(row.data as string),
      createdAt: row.createdAt.getTime(),
      publishedAt: row.publishedAt ? row.publishedAt.getTime() : null
    }
  };
};
