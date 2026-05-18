import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // `/me/+layout.server.ts` already gates anonymous access; this guard
  // satisfies the type narrowing.
  const userId = locals.user!.id;

  const rows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      data: schema.content.data,
      visibility: schema.content.visibility,
      updatedAt: schema.content.updatedAt,
      createdAt: schema.content.createdAt
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'feat'), eq(schema.content.ownerUserId, userId)));

  const feats = rows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        description?: string;
        choices?: Record<string, unknown>;
        modifiers?: unknown[];
      };
      const enabledChoices = Object.keys(data.choices ?? {});
      return {
        slug: r.slug,
        name: r.name,
        visibility: r.visibility as 'private' | 'unlisted' | 'public',
        category: data.category ?? '',
        modifierCount: Array.isArray(data.modifiers) ? data.modifiers.length : 0,
        choiceCount: enabledChoices.length,
        enabledChoices,
        updatedAt: (r.updatedAt ?? r.createdAt).getTime()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { feats };
};
