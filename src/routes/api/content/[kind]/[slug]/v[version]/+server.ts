import { json, error } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { ContentKind } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { RequestHandler } from './$types';

const Params = z.object({
  kind: ContentKind,
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  version: z.coerce.number().int().positive()
});

const sources = [...PUBLIC_SOURCES];

export const GET: RequestHandler = async ({ params }) => {
  const { kind, slug, version } = parseParams(params, Params);

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
    .where(
      and(
        eq(schema.content.kind, kind),
        eq(schema.content.slug, slug),
        eq(schema.content.version, version),
        inArray(schema.content.source, sources),
        sql`${schema.content.scopeId} IS NULL`
      )
    )
    .limit(1);

  if (rows.length === 0) throw error(404, 'content not found');
  const r = rows[0];
  return json(
    { kind: r.kind, slug: r.slug, version: r.version, name: r.name, source: r.source, data: JSON.parse(r.data as string) },
    { headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=86400' } }
  );
};

export const openapi = {
  GET: { summary: 'Fetch a specific pinned version of a content row' }
} as const;
