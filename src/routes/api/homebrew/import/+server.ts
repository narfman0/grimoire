// POST /api/homebrew/import — bulk-import a pack-shaped JSON manifest as the
// caller's owned homebrew. The endpoint pairs with GET /api/homebrew/export
// (same shape in both directions) so a user can round-trip their authored
// content between instances without admin privileges or filesystem access.
//
// Per-row semantics:
//   - ownerUserId = caller's user id
//   - packSlug    = 'homebrew' (the synthetic FK target seeded by the
//                   homebrew-pack migration; required by the schema)
//   - source      = row.source ?? meta.default_source
//   - visibility  = 'unlisted' (matches what the on-disk loader stamps)
//
// Upsert key: (kind, slug, version, owner_user_id). Re-importing the same
// manifest as the same user updates the user's rows in place; it never
// touches another user's rows or the SRD-pack-loaded global rows that share
// a slug (owner_user_id = null is a distinct identity).
//
// The whole import runs inside one db.transaction. Per-row validation
// failures (bad `data` payload for the row's kind) are collected into
// errors[] and reported in the response — they do NOT abort sibling rows.
// A txn-level throw (rare; only for DB errors) rolls back everything.

import { json, error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson } from '$lib/server/api/validate';
import {
  HOMEBREW_IMPORT_MAX_ROWS,
  HomebrewImportRequest,
  homebrewSchemaFor
} from '$lib/server/content/schemas';
import type { RequestHandler } from './$types';

const HOMEBREW_PACK_SLUG = 'homebrew';

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ slug: string; kind: string; reason: string }>;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const ownerUserId = locals.user.id;

  const body = await parseJson(request, HomebrewImportRequest);
  if (body.rows.length > HOMEBREW_IMPORT_MAX_ROWS) {
    throw error(413, `too many rows (max ${HOMEBREW_IMPORT_MAX_ROWS})`);
  }

  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const now = new Date();

  try {
    db.transaction((tx) => {
      for (const row of body.rows) {
        // Validate the per-row data payload against the kind-specific schema.
        // Unknown kinds and shape failures land in errors[] and the row is
        // skipped; sibling rows continue.
        const dataSchema = homebrewSchemaFor(row.kind);
        if (!dataSchema) {
          result.errors.push({
            slug: row.slug,
            kind: row.kind,
            reason: `unknown content kind: ${row.kind}`
          });
          result.skipped += 1;
          continue;
        }
        const dataParsed = dataSchema.safeParse(row.data);
        if (!dataParsed.success) {
          result.errors.push({
            slug: row.slug,
            kind: row.kind,
            reason: dataParsed.error.issues
              .map((i) => `data.${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('; ')
          });
          result.skipped += 1;
          continue;
        }

        const source = row.source ?? body.meta.default_source;
        const dataJson = JSON.stringify(dataParsed.data);

        // Upsert on (kind, slug, version, owner_user_id). Scope is always
        // null for homebrew — per-campaign rows aren't writable via this
        // endpoint yet.
        const existing = tx
          .select({ id: schema.content.id })
          .from(schema.content)
          .where(
            and(
              eq(schema.content.kind, row.kind),
              eq(schema.content.slug, row.slug),
              eq(schema.content.version, row.version),
              eq(schema.content.ownerUserId, ownerUserId),
              isNull(schema.content.scopeId)
            )
          )
          .limit(1)
          .all();

        if (existing.length === 0) {
          tx.insert(schema.content)
            .values({
              id: crypto.randomUUID(),
              kind: row.kind,
              slug: row.slug,
              version: row.version,
              source,
              scopeId: null,
              ownerUserId,
              packSlug: HOMEBREW_PACK_SLUG,
              name: row.name,
              data: dataJson,
              visibility: 'unlisted',
              createdAt: now,
              updatedAt: now
            })
            .run();
          result.created += 1;
        } else {
          tx.update(schema.content)
            .set({
              name: row.name,
              source,
              data: dataJson,
              updatedAt: now
            })
            .where(eq(schema.content.id, existing[0].id))
            .run();
          result.updated += 1;
        }
      }
    });
  } catch (err) {
    handleDbError(err, 'homebrew:import');
  }

  return json(result);
};

export const _openapi = {
  POST: {
    summary: "Bulk import a pack-shaped manifest as the caller's homebrew",
    body: HomebrewImportRequest
  }
} as const;
