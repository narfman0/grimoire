import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = locals.user!.id;
  const [row] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, 'feat'),
        eq(schema.content.slug, params.slug),
        eq(schema.content.ownerUserId, userId)
      )
    )
    .limit(1);
  if (!row) throw error(404, 'feat not found');
  return {
    feat: {
      slug: row.slug,
      name: row.name,
      visibility: row.visibility as 'private' | 'unlisted' | 'public',
      data: JSON.parse(row.data as string)
    }
  };
};
