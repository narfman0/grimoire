// List the caller's homebrew rows of a given kind: feat, spell, item,
// monster, etc.
//
// Versioning: a (kind, slug, owner) tuple can have multiple rows after the
// versioning migration. We collapse to the latest row per slug so the list
// shows one entry per logical homebrew item.

import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = locals.user!.id;
  const kind = params.kind;
  if (!HOMEBREW_KINDS.includes(kind as (typeof HOMEBREW_KINDS)[number])) {
    throw error(404, `unknown content kind: ${kind}`);
  }
  const rows = await db
    .select({
      slug: schema.content.slug,
      version: schema.content.version,
      name: schema.content.name,
      visibility: schema.content.visibility,
      data: schema.content.data,
      updatedAt: schema.content.updatedAt,
      createdAt: schema.content.createdAt,
      publishedAt: schema.content.publishedAt
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, kind), eq(schema.content.ownerUserId, userId)));

  // Collapse to the latest row per slug.
  const latestBySlug = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prior = latestBySlug.get(r.slug);
    if (!prior || r.version > prior.version) latestBySlug.set(r.slug, r);
  }

  const items = Array.from(latestBySlug.values())
    .map((r) => {
      const data = JSON.parse(r.data as string) as { description?: string; category?: string };
      return {
        slug: r.slug,
        name: r.name,
        version: r.version,
        visibility: r.visibility as 'private' | 'unlisted' | 'public',
        isDraft: r.publishedAt === null,
        category: data.category ?? '',
        description: (data.description ?? '').slice(0, 120),
        updatedAt: (r.updatedAt ?? r.createdAt).getTime()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { kind, items };
};
