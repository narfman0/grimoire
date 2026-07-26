// Packs CRUD — collection endpoints.
//
//   POST /api/packs            — create a new pack owned by the caller
//   GET  /api/packs            — list packs (defaults to caller's own + public)
//
// Per-pack detail / mutation lives at /api/packs/[slug].
//
// The `'homebrew'` slug is reserved for the synthetic in-app fast-path
// bucket: rows created via single-row CRUD without a packSlug land there,
// shared across all users. Pack creates that target it are refused so the
// bucket isn't co-opted by an ordinary user-owned pack.

import { json, error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { parseJson } from '$lib/server/api/validate';
import { PackSlug, Visibility } from '$lib/server/content/schemas';
import { invalidateContentCache } from '$lib/server/content/cache';
import { requireUser } from '$lib/server/auth/guards';
import { serializePack } from '$lib/server/serializers';
import { Pack, PackList } from '$lib/server/api/responses';
import type { RequestHandler } from './$types';

/** Slugs the user can never create/delete; they're system-owned and the
 *  loader / single-row endpoints depend on the row existing. */
export const _SYSTEM_PACK_SLUGS = new Set(['homebrew', 'srd-5.2', 'srd-5.1']);

/** Body for POST /api/packs. */
export const _PackCreateBody = z.object({
  slug: PackSlug,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  version: z.string().min(1).max(64).default('1.0'),
  edition: z.string().min(1).max(32).optional(),
  visibility: Visibility.optional()
});
export type PackCreateBody = z.infer<typeof _PackCreateBody>;

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireUser(locals);
  const body = await parseJson(request, _PackCreateBody);

  if (_SYSTEM_PACK_SLUGS.has(body.slug)) {
    throw error(409, `pack slug "${body.slug}" is reserved`);
  }

  // Up-front uniqueness check so we can return a friendly 409 instead of a
  // raw FK/unique constraint message.
  const existing = await db
    .select({ slug: schema.packs.slug })
    .from(schema.packs)
    .where(eq(schema.packs.slug, body.slug))
    .limit(1);
  if (existing.length > 0) throw error(409, `pack "${body.slug}" already exists`);

  const now = new Date();
  await db
    .insert(schema.packs)
    .values({
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      version: body.version,
      defaultSource: body.slug,
      loadedAt: now,
      author: user.username,
      edition: body.edition ?? null,
      ownerUserId: user.id,
      visibility: body.visibility ?? 'private',
      createdAt: now,
      updatedAt: now
    })
    .catch((err) => handleDbError(err, 'packs:create'));
  invalidateContentCache();

  const [row] = await db
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.slug, body.slug))
    .limit(1);
  return json(serializePack(row, 0), { status: 201 });
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const ownerFilter = url.searchParams.get('owner');

  // Visibility rules:
  //   anonymous: only public packs.
  //   logged in: caller's own packs (any visibility) + public packs from others.
  //   ?owner=<id>: scope to that user's visible-to-caller packs.
  let where;
  if (!locals.user) {
    where = eq(schema.packs.visibility, 'public');
  } else if (ownerFilter) {
    if (ownerFilter === locals.user.id) {
      where = eq(schema.packs.ownerUserId, ownerFilter);
    } else {
      where = and(
        eq(schema.packs.ownerUserId, ownerFilter),
        eq(schema.packs.visibility, 'public')
      );
    }
  } else {
    // self OR public OR system packs (NULL owner are SRD/homebrew which are
    // surfaced for everyone regardless of visibility on the index — they
    // anchor the FK and shouldn't ever be hidden by accident).
    where = or(
      eq(schema.packs.ownerUserId, locals.user.id),
      eq(schema.packs.visibility, 'public'),
      isNull(schema.packs.ownerUserId)
    );
  }

  const rows = await db.select().from(schema.packs).where(where);

  // Row counts in one shot via a group-by, then re-merged onto the pack rows
  // so callers don't have to hit /api/packs/[slug] just to count.
  const counts =
    rows.length === 0
      ? []
      : await db
          .select({
            packSlug: schema.content.packSlug,
            count: sql<number>`count(*)`.as('count')
          })
          .from(schema.content)
          .where(
            inArray(
              schema.content.packSlug,
              rows.map((r) => r.slug)
            )
          )
          .groupBy(schema.content.packSlug);
  const countBySlug = new Map(counts.map((c) => [c.packSlug, Number(c.count)]));

  return json({
    items: rows
      .map((p) => serializePack(p, countBySlug.get(p.slug) ?? 0))
      .sort((a, b) => a.name.localeCompare(b.name))
  });
};

const ListQuery = z.object({
  /** Scope to one owner's packs (their public packs unless it is the caller). */
  owner: z.string().optional()
});

export const _openapi = {
  POST: {
    summary: 'Create a new content pack owned by the caller',
    body: _PackCreateBody,
    response: Pack,
    status: 201,
    errors: [{ status: 409, description: 'Pack slug already exists or is reserved' }]
  },
  GET: {
    summary: 'List packs visible to the caller (self + public + system)',
    query: ListQuery,
    response: PackList,
    public: true
  }
} as const;
