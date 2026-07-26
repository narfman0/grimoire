// Packs CRUD — single-pack endpoints.
//
//   GET    /api/packs/[slug]                — detail + per-kind row counts
//   PATCH  /api/packs/[slug]                — edit metadata or rename slug
//   DELETE /api/packs/[slug]?cascade=true   — wipe pack + rows (owner only)
//
// Rename semantics: `body.newSlug` triggers a transactional rename — both
// `packs.slug` and `content.pack_slug WHERE pack_slug = old slug` are
// updated atomically so the FK never dangles.

import { json, error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { PackSlug, Visibility } from '$lib/server/content/schemas';
import { invalidateContentCache } from '$lib/server/content/cache';
import { requireUser } from '$lib/server/auth/guards';
import { serializePack } from '$lib/server/serializers';
import { _SYSTEM_PACK_SLUGS } from '../+server';
import type { RequestHandler } from './$types';

const Params = z.object({ slug: PackSlug });

export const _PackPatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    version: z.string().min(1).max(64).optional(),
    edition: z.string().min(1).max(32).nullable().optional(),
    visibility: Visibility.optional(),
    /** Rename. Cascades to `content.pack_slug` in the same transaction so the
     *  FK never dangles. Refused for system packs and slug collisions. */
    newSlug: PackSlug.optional()
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.description !== undefined ||
      b.version !== undefined ||
      b.edition !== undefined ||
      b.visibility !== undefined ||
      b.newSlug !== undefined,
    { message: 'at least one field must be provided' }
  );
export type PackPatchBody = z.infer<typeof _PackPatchBody>;

/** Throws 404 if the slug doesn't exist or the caller can't see it. */
async function loadVisiblePack(
  slug: string,
  user: { id: string } | null
): Promise<typeof schema.packs.$inferSelect> {
  const [row] = await db
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, slug))
    .limit(1);
  if (!row) throw error(404, 'pack not found');

  // System packs (null owner: SRD, homebrew) are always visible. Otherwise
  // owners see anything; non-owners need visibility != 'private'.
  if (row.ownerUserId !== null && row.ownerUserId !== user?.id && row.visibility === 'private') {
    throw error(404, 'pack not found');
  }
  return row;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const { slug } = parseParams({ slug: params.slug }, Params);
  const pack = await loadVisiblePack(slug, locals.user);

  const byKindRows = await db
    .select({
      kind: schema.content.kind,
      count: sql<number>`count(*)`.as('count')
    })
    .from(schema.content)
    .where(eq(schema.content.packSlug, slug))
    .groupBy(schema.content.kind);

  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of byKindRows) {
    const n = Number(r.count);
    byKind[r.kind] = n;
    total += n;
  }
  return json(serializePack(pack, total, byKind));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { slug } = parseParams({ slug: params.slug }, Params);
  const body = await parseJson(request, _PackPatchBody);

  const [existing] = await db
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, slug))
    .limit(1);
  if (!existing) throw error(404, 'pack not found');

  // Ownership: system packs (null owner) are unrentable; everyone else
  // must match the caller's id.
  if (existing.ownerUserId === null) throw error(403, 'system packs cannot be edited');
  if (existing.ownerUserId !== user.id) throw error(403, 'not your pack');

  const now = new Date();

  // Slug rename is the interesting branch — it cascades to content.pack_slug
  // and re-checks collision. Pure-metadata edits skip the txn.
  if (body.newSlug && body.newSlug !== slug) {
    if (_SYSTEM_PACK_SLUGS.has(body.newSlug)) {
      throw error(409, `pack slug "${body.newSlug}" is reserved`);
    }
    const [collision] = await db
      .select({ slug: schema.packs.slug })
      .from(schema.packs)
      .where(eq(schema.packs.slug, body.newSlug))
      .limit(1);
    if (collision) throw error(409, `pack "${body.newSlug}" already exists`);

    try {
      db.transaction((tx) => {
        // Order matters: content.pack_slug has a FK into packs.slug; flip
        // the parent first, then re-point children. SQLite FKs default to
        // immediate so we briefly disable them — re-enable inside the txn
        // so the snapshot stays consistent post-commit.
        tx.run(sql`PRAGMA defer_foreign_keys = ON`);
        tx.update(schema.packs)
          .set({
            slug: body.newSlug!,
            name: body.name ?? existing.name,
            description: body.description !== undefined ? body.description : existing.description,
            version: body.version ?? existing.version,
            edition: body.edition !== undefined ? body.edition : existing.edition,
            visibility: body.visibility ?? existing.visibility,
            updatedAt: now
          })
          .where(eq(schema.packs.slug, slug))
          .run();
        tx.update(schema.content)
          .set({ packSlug: body.newSlug! })
          .where(eq(schema.content.packSlug, slug))
          .run();
      });
    } catch (err) {
      handleDbError(err, 'packs:rename');
    }
    invalidateContentCache();

    const [renamed] = await db
      .select()
      .from(schema.packs)
      .where(eq(schema.packs.slug, body.newSlug))
      .limit(1);
    return json(serializePack(renamed, 0, {}));
  }

  // Pure metadata edit.
  const setObj: Partial<typeof schema.packs.$inferInsert> = { updatedAt: now };
  if (body.name !== undefined) setObj.name = body.name;
  if (body.description !== undefined) setObj.description = body.description;
  if (body.version !== undefined) setObj.version = body.version;
  if (body.edition !== undefined) setObj.edition = body.edition;
  if (body.visibility !== undefined) setObj.visibility = body.visibility;

  await db
    .update(schema.packs)
    .set(setObj)
    .where(eq(schema.packs.slug, slug))
    .catch((err) => handleDbError(err, 'packs:patch'));
  invalidateContentCache();

  const [updated] = await db.select().from(schema.packs).where(eq(schema.packs.slug, slug)).limit(1);
  return json(serializePack(updated, 0, {}));
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
  const user = requireUser(locals);
  const { slug } = parseParams({ slug: params.slug }, Params);
  const cascade = url.searchParams.get('cascade') === 'true';

  if (_SYSTEM_PACK_SLUGS.has(slug)) {
    throw error(400, `system pack "${slug}" cannot be deleted`);
  }

  const [existing] = await db
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, slug))
    .limit(1);
  if (!existing) throw error(404, 'pack not found');
  if (existing.ownerUserId === null) throw error(403, 'system packs cannot be deleted');
  if (existing.ownerUserId !== user.id) throw error(403, 'not your pack');

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(schema.content)
    .where(eq(schema.content.packSlug, slug));
  const n = Number(count);
  if (n > 0 && !cascade) {
    throw error(409, `pack "${slug}" has ${n} content rows — pass ?cascade=true to delete them too`);
  }

  try {
    db.transaction((tx) => {
      if (n > 0) {
        tx.delete(schema.content).where(eq(schema.content.packSlug, slug)).run();
      }
      tx.delete(schema.packs).where(eq(schema.packs.slug, slug)).run();
    });
  } catch (err) {
    handleDbError(err, 'packs:delete');
  }
  invalidateContentCache();

  return json({ deleted: true, rowsDeleted: n });
};

export const _openapi = {
  GET: { summary: 'Fetch pack detail + per-kind row counts' },
  PATCH: { summary: 'Update pack metadata or rename slug (owner only)', body: _PackPatchBody },
  DELETE: { summary: 'Delete a pack (owner only); requires ?cascade=true when rows exist' }
} as const;
