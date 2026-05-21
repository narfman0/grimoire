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
  rows: z.array(ImportRow).min(1).max(10000)
});

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  if (!locals.user.isAdmin) throw error(403, 'admin only');

  const body = await parseJson(request, ImportContentRequest);
  const ownerUserId = locals.user.id;
  const mode = body.mode ?? 'skip';

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const failed: Array<{ kind: string; slug: string; error: string }> = [];

  // Pull every (kind, slug) the caller already owns; cheap one-shot
  // lookup avoids N round-trips inside the txn.
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

  // Pull every (kind, slug) that exists globally and is NOT owned by the
  // caller. Inserting a clash here would 409 against the unique index
  // (kind, slug, version, scope_id) since pack-loaded rows have
  // ownerUserId='packs'-side identity but the same kind+slug+version=1
  // shape we're about to write. Report those as failed (with a clear
  // message) so the caller knows what the conflict was.
  const otherById = new Map<string, string>(); // `${kind}/${slug}` → ownerUserId
  const allRows = await db
    .select({ kind: schema.content.kind, slug: schema.content.slug, ownerUserId: schema.content.ownerUserId })
    .from(schema.content);
  for (const r of allRows) {
    if (r.ownerUserId === ownerUserId) continue;
    otherById.set(`${r.kind}/${r.slug}`, r.ownerUserId ?? '(unowned)');
  }

  const now = new Date();
  db.transaction((tx) => {
    for (const r of body.rows) {
      const key = `${r.kind}/${r.slug}`;
      const existingId = ownedById.get(key);

      if (existingId) {
        if (mode === 'replace') {
          tx.update(schema.content)
            .set({ name: r.name, data: JSON.stringify(r.data), updatedAt: now })
            .where(eq(schema.content.id, existingId))
            .run();
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      const otherOwner = otherById.get(key);
      if (otherOwner) {
        // A different user (or pack-loaded global row) already holds
        // this slug. Importing would either 409 on the unique index or
        // create a parallel row depending on the version; safest to
        // report and skip.
        failed.push({
          kind: r.kind,
          slug: r.slug,
          error: `slug already owned by another user (${otherOwner})`
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
            name: r.name,
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

  return json({ inserted, updated, skipped, failed });
};

export const openapi = {
  POST: { summary: 'Bulk import content rows as homebrew (admin only)', body: ImportContentRequest }
} as const;
