import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { ContentKind } from '$lib/server/api/schemas';
import { parseSearch } from '$lib/server/api/validate';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { RequestHandler } from './$types';

const ListQuery = z.object({
  kind: ContentKind.optional(),
  source: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
  include: z.enum(['data']).optional()
});

const sources = [...PUBLIC_SOURCES];

export const GET: RequestHandler = async ({ url }) => {
  const q = parseSearch(url, ListQuery);

  const sourceFilter = q.source && PUBLIC_SOURCES.has(q.source) ? [q.source] : sources;

  const where = q.kind
    ? and(eq(schema.content.kind, q.kind), inArray(schema.content.source, sourceFilter))
    : inArray(schema.content.source, sourceFilter);

  const totalRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.content)
    .where(where);
  const total = totalRows[0]?.c ?? 0;

  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      version: schema.content.version,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(where)
    .orderBy(asc(schema.content.kind), asc(schema.content.slug), asc(schema.content.version))
    .limit(q.limit)
    .offset(q.offset);

  const items = rows.map((r) => {
    const { data, ...summary } = r;
    return q.include === 'data' ? { ...summary, data: JSON.parse(data as string) } : summary;
  });

  return json(
    { items, total, limit: q.limit, offset: q.offset },
    { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' } }
  );
};
