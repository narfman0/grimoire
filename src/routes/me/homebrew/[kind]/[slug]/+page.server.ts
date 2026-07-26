import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = locals.user!.id;
  const kind = params.kind;
  if (!HOMEBREW_KINDS.includes(kind as (typeof HOMEBREW_KINDS)[number])) {
    throw error(404, `unknown content kind: ${kind}`);
  }
  // Pick the highest-version row. The author always edits the latest copy
  // (which may be a draft sitting above a previously-published version).
  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, params.slug),
        eq(schema.content.ownerUserId, userId)
      )
    )
    .orderBy(desc(schema.content.version))
    .limit(1);
  if (!row) throw error(404, `${kind} not found`);
  return {
    kind,
    item: {
      kind,
      slug: row.slug,
      version: row.version,
      name: row.name,
      visibility: row.visibility as 'private' | 'unlisted' | 'public',
      isDraft: row.publishedAt === null,
      data: JSON.parse(row.data as string)
    }
  };
};
