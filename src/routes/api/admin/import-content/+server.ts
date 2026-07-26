// Bulk import content rows directly as the caller's homebrew. Admin-only.
//
// Use when seeding a grimoire instance from an existing pack tree (the
// kind of thing the file-based pack loader does at server boot, but
// driven from a remote machine over HTTP). The on-disk pack loader is
// strict-shape-permissive (just records the JSON); the per-kind
// /api/homebrew/[kind] endpoints are NOT — they enforce the editor's
// structured schemas. This endpoint lives in the middle: same identity
// rules as homebrew (source='homebrew', packSlug='homebrew',
// ownerUserId=caller), same permissive data shape as the pack loader.
//
// Single transaction. Duplicates (same kind+slug+ownerUserId) are
// reported in `skipped` by default; pass mode='replace' to overwrite
// the data + name in place instead.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { ContentKind } from '$lib/server/api/schemas';
import { Slug } from '$lib/server/content/schemas';
import { parseJson } from '$lib/server/api/validate';
import { invalidateContentCache } from '$lib/server/content/cache';
import type { RequestHandler } from './$types';

const HOMEBREW_PACK_SLUG = 'homebrew';
const HOMEBREW_SOURCE = 'homebrew';

const ImportRow = z.object({
  kind: ContentKind,
  slug: Slug,
  name: z.string().min(1).max(200),
  version: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown())
});

const ImportContentRequest = z.object({
  mode: z.enum(['skip', 'replace']).optional(),
  rows: z.array(ImportRow).min(1).max(10000),
  /** When an incoming row's (kind, slug) collides with a globally-owned
   *  (pack-loaded) row, append this string to the imported row's name so
   *  pickers can disambiguate. Example: ' (2014)' turns "Alert" into
   *  "Alert (2014)" in the homebrew row, while SRD's "Alert" stays as-is.
   *  No-op for rows without a global collision. */
  nameSuffixOnGlobalConflict: z.string().max(64).optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  if (!locals.user.isAdmin) throw error(403, 'admin only');

  const body = await parseJson(request, ImportContentRequest);
  const ownerUserId = locals.user.id;
  const mode = body.mode ?? 'skip';
  const suffix = body.nameSuffixOnGlobalConflict ?? '';

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const failed: Array<{ kind: string; slug: string; error: string }> = [];

  // Cache the caller's own rows so we know which slugs need insert vs
  // update — cheap one-shot avoids N round-trips inside the txn.
  const existingOwned = await db
    .select({
      id: schema.content.id,
      kind: schema.content.kind,
      slug: schema.content.slug
    })
    .from(schema.content)
    .where(eq(schema.content.ownerUserId, ownerUserId));
  const ownedById = new Map<string, string>(); // `${kind}/${slug}` → id
  for (const r of existingOwned) ownedById.set(`${r.kind}/${r.slug}`, r.id);

  // Cache pack-loaded (owner=null) slugs so we can flag conflicts and
  // optionally apply the disambiguating name suffix. The DB unique index
  // is on (kind, slug, version, scope_id, owner_user_id) — pack rows
  // (owner=null) and homebrew rows (owner=caller) coexist fine.
  const globalSlugs = new Set<string>();
  const otherOwned = new Map<string, string>(); // for messaging only
  const allRows = await db
    .select({ kind: schema.content.kind, slug: schema.content.slug, ownerUserId: schema.content.ownerUserId })
    .from(schema.content);
  for (const r of allRows) {
    if (r.ownerUserId === ownerUserId) continue;
    const key = `${r.kind}/${r.slug}`;
    if (r.ownerUserId === null) globalSlugs.add(key);
    else otherOwned.set(key, r.ownerUserId);
  }

  const now = new Date();
  db.transaction((tx) => {
    for (const r of body.rows) {
      const key = `${r.kind}/${r.slug}`;
      const existingId = ownedById.get(key);
      const conflictsWithGlobal = globalSlugs.has(key);
      const insertName = conflictsWithGlobal && suffix ? `${r.name}${suffix}` : r.name;

      if (existingId) {
        if (mode === 'replace') {
          tx.update(schema.content)
            .set({ name: insertName, data: JSON.stringify(r.data), updatedAt: now })
            .where(eq(schema.content.id, existingId))
            .run();
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Cross-user (non-pack) collisions are still reported as failures —
      // distinct authors writing the same homebrew slug is ambiguous and
      // currently has no UI affordance to disambiguate.
      const otherUser = otherOwned.get(key);
      if (otherUser) {
        failed.push({
          kind: r.kind,
          slug: r.slug,
          error: `slug already owned by another user (${otherUser})`
        });
        continue;
      }

      try {
        tx.insert(schema.content)
          .values({
            id: crypto.randomUUID(),
            kind: r.kind,
            slug: r.slug,
            version: r.version ?? 1,
            source: HOMEBREW_SOURCE,
            scopeId: null,
            ownerUserId,
            packSlug: HOMEBREW_PACK_SLUG,
            name: insertName,
            data: JSON.stringify(r.data),
            visibility: 'private',
            createdAt: now,
            updatedAt: now
          })
          .run();
        inserted++;
      } catch (err) {
        failed.push({
          kind: r.kind,
          slug: r.slug,
          error: (err as Error).message.slice(0, 200)
        });
      }
    }
  });
  invalidateContentCache();

  return json({ inserted, updated, skipped, failed });
};

export const _openapi = {
  POST: { summary: 'Bulk import content rows as homebrew (admin only)', body: ImportContentRequest }
} as const;
