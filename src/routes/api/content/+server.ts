import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { ContentKind } from '$lib/server/api/schemas';
import { parseSearch } from '$lib/server/api/validate';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { RequestHandler } from './$types';

const ListQuery = z.object({
  kind: ContentKind.optional(),
  source: z.string().optional(),
  /** Filter to a specific visibility. Defaults to 'public' for the browse
   *  use case (pack content is always public; homebrew rows respect this
   *  column). 'unlisted' / 'private' require either ownership or admin —
   *  enforced below; non-matching rows are 404 / filtered out. */
  visibility: z.enum(['public', 'unlisted']).optional(),
  /** Filter to a single author — when set, return only rows owned by this
   *  user (in addition to source/visibility constraints). */
  authorUserId: z.string().optional(),
  /** Substring filter against `name` (LIKE %q%). */
  q: z.string().min(1).max(100).optional(),
  sort: z.enum(['newest', 'name']).default('name'),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
  include: z.enum(['data']).optional()
});

const PUBLIC_SOURCE_LIST = [...PUBLIC_SOURCES];

export const GET: RequestHandler = async ({ url }) => {
  const q = parseSearch(url, ListQuery);

  // Visibility logic:
  //   - Pack content (source in PUBLIC_SOURCES) is always exposed and has
  //     visibility='public' after the 0010 backfill.
  //   - Homebrew rows (source='homebrew') are exposed only when their
  //     visibility column matches the requested filter (default: 'public').
  //   - Other non-public sources (grimoire-packs etc.) stay hidden from
  //     this surface — same as before.
  const requestedVisibility = q.visibility ?? 'public';
  const sourceFilter =
    q.source && PUBLIC_SOURCES.has(q.source) ? [q.source] : PUBLIC_SOURCE_LIST;

  const visibilityClause = or(
    inArray(schema.content.source, sourceFilter),
    and(
      eq(schema.content.source, 'homebrew'),
      eq(schema.content.visibility, requestedVisibility)
    )
  );

  const clauses = [visibilityClause!];
  if (q.kind) clauses.push(eq(schema.content.kind, q.kind));
  if (q.authorUserId) clauses.push(eq(schema.content.ownerUserId, q.authorUserId));
  if (q.q) clauses.push(like(schema.content.name, `%${q.q}%`));

  const where = and(...clauses);

  const totalRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.content)
    .where(where);
  const total = totalRows[0]?.c ?? 0;

  const orderBy =
    q.sort === 'newest'
      ? [desc(schema.content.createdAt), asc(schema.content.name)]
      : [asc(schema.content.kind), asc(schema.content.name)];

  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      version: schema.content.version,
      name: schema.content.name,
      source: schema.content.source,
      visibility: schema.content.visibility,
      ownerUserId: schema.content.ownerUserId,
      authorUsername: schema.users.username,
      createdAt: schema.content.createdAt,
      data: schema.content.data
    })
    .from(schema.content)
    .leftJoin(schema.users, eq(schema.users.id, schema.content.ownerUserId))
    .where(where)
    .orderBy(...orderBy)
    .limit(q.limit)
    .offset(q.offset);

  const items = rows.map((r) => {
    const { data, createdAt, ...summary } = r;
    const base = {
      ...summary,
      createdAt: createdAt.getTime()
    };
    return q.include === 'data' ? { ...base, data: JSON.parse(data as string) } : base;
  });

  return json(
    { items, total, limit: q.limit, offset: q.offset },
    { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=86400' } }
  );
};

export const _openapi = {
  GET: { summary: 'List public catalog content rows' }
} as const;
