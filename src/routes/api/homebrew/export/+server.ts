// GET /api/homebrew/export — pack-shaped dump of the caller's owned
// homebrew. Output matches the POST /api/homebrew/import body shape exactly
// so an export → import roundtrip (for the same user) is a no-op.
//
// Query params:
//   ?kind=feature       — filter to one content kind (default: all kinds)
//   ?source=my-pack     — filter to one source slug (legacy filter; still works)
//   ?pack=my-pack       — filter to one pack slug; without this, every row
//                          across every pack the caller owns is exported
//   ?include_deleted    — accepted but ignored; soft-delete isn't a thing yet
//
// When the user has no rows the response is { meta: null, rows: [] } so
// the client can branch trivially. When rows are present, meta is
// synthesized from the most common (source, count) — good enough for a
// roundtrip; users who want a richer manifest can edit `meta` themselves
// before re-importing.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface ExportRow {
  kind: string;
  slug: string;
  version: number;
  name: string;
  source?: string;
  data: unknown;
}

interface ExportMeta {
  slug: string;
  name: string;
  version: string;
  default_source: string;
  author?: string;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const ownerUserId = locals.user.id;

  const kindFilter = url.searchParams.get('kind');
  const sourceFilter = url.searchParams.get('source');
  const packFilter = url.searchParams.get('pack');

  const conditions = [eq(schema.content.ownerUserId, ownerUserId)];
  if (kindFilter) conditions.push(eq(schema.content.kind, kindFilter));
  if (sourceFilter) conditions.push(eq(schema.content.source, sourceFilter));
  if (packFilter) conditions.push(eq(schema.content.packSlug, packFilter));

  const rows = await db
    .select()
    .from(schema.content)
    .where(and(...conditions));

  if (rows.length === 0) {
    return json({ meta: null, rows: [] });
  }

  // Pick the most common source slug as default_source for the wrapper meta.
  // Rows whose source matches default_source omit the field in the export so
  // the manifest stays compact; rows that differ keep their explicit source.
  const sourceCounts = new Map<string, number>();
  for (const r of rows) sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  const [defaultSource] = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  const meta: ExportMeta = {
    slug: defaultSource,
    name: locals.user.username ? `${locals.user.username}'s homebrew` : 'homebrew',
    version: '1',
    default_source: defaultSource,
    author: locals.user.username ?? undefined
  };

  const outRows: ExportRow[] = rows
    .sort((a, b) =>
      a.kind === b.kind ? a.slug.localeCompare(b.slug) : a.kind.localeCompare(b.kind)
    )
    .map((r) => {
      const row: ExportRow = {
        kind: r.kind,
        slug: r.slug,
        version: r.version,
        name: r.name,
        data: JSON.parse(r.data as string)
      };
      if (r.source !== defaultSource) row.source = r.source;
      return row;
    });

  return json({ meta, rows: outRows });
};

export const _openapi = {
  GET: { summary: "Export the caller's homebrew as an import-ready manifest" }
} as const;
