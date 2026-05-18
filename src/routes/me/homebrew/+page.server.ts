// /me/homebrew — index page listing every content kind with the caller's
// count + subscriber count. Click a kind to drill into its list view.

import { eq, sql } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;

  // Count rows per kind owned by the caller.
  const countRows = await db
    .select({
      kind: schema.content.kind,
      n: sql<number>`count(*)`
    })
    .from(schema.content)
    .where(eq(schema.content.ownerUserId, userId))
    .groupBy(schema.content.kind);

  const counts: Record<string, number> = {};
  for (const r of countRows) counts[r.kind] = r.n;

  // Subscriptions count (kind-agnostic for header).
  const [subRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.homebrewSubscriptions)
    .where(eq(schema.homebrewSubscriptions.userId, userId));

  return {
    kinds: HOMEBREW_KINDS.map((kind) => ({
      kind,
      count: counts[kind] ?? 0,
      // Feat keeps its bespoke path; everything else is dynamic.
      href: kind === 'feat' ? '/me/homebrew/feats' : `/me/homebrew/${kind}`
    })),
    subscriptionCount: subRow?.n ?? 0
  };
};
