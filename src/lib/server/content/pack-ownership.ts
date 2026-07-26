// Shared helper for the single-row homebrew endpoints
// (POST /api/homebrew/[kind], fork).
//
// Both accept an optional `packSlug` body field; when present we have
// to make sure the caller actually owns the pack (or that it's the fast-path
// 'homebrew' bucket). This used to be inlined per-endpoint; pulling it out
// gives us one canonical permission gate and one error message shape.

import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';

export const HOMEBREW_PACK_SLUG = 'homebrew';

/**
 * Resolve the pack slug a single-row create should land in. Defaults to
 * the fast-path 'homebrew' bucket; if the caller specified a different
 * pack, verify it exists and is owned by them.
 *
 * Throws SvelteKit errors:
 *   - 404 if the pack doesn't exist
 *   - 403 if the pack exists but the caller isn't the owner
 */
export async function resolvePackSlugForCreate(
  bodyPackSlug: string | undefined,
  callerUserId: string
): Promise<string> {
  const slug = bodyPackSlug ?? HOMEBREW_PACK_SLUG;
  if (slug === HOMEBREW_PACK_SLUG) return slug;

  const [pack] = await db
    .select({ ownerUserId: schema.packs.ownerUserId })
    .from(schema.packs)
    .where(eq(schema.packs.slug, slug))
    .limit(1);
  if (!pack) throw error(404, `pack "${slug}" not found`);
  if (pack.ownerUserId !== callerUserId) {
    throw error(403, `pack "${slug}" is not owned by you`);
  }
  return slug;
}
