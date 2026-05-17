// Server-side helpers for running the rules engine against DB-loaded content.
// The boot loader populates the `content` table; this builds an in-memory
// Map keyed by `${kind}/${slug}` for the engine's ContentLookup interface.

import { db, schema } from '$lib/server/db';
import type { ContentLookup, ContentRow, Derived } from '$lib/rules/types';

export async function buildContentLookup(): Promise<{
  lookup: ContentLookup;
  map: Record<string, ContentRow>;
  size: number;
}> {
  const rows = await db
    .select({
      kind: schema.content.kind,
      slug: schema.content.slug,
      version: schema.content.version,
      source: schema.content.source,
      name: schema.content.name,
      data: schema.content.data
    })
    .from(schema.content);

  const byKey = new Map<string, ContentRow>();
  const map: Record<string, ContentRow> = {};
  for (const r of rows) {
    const row: ContentRow = {
      kind: r.kind,
      slug: r.slug,
      version: r.version,
      source: r.source,
      name: r.name,
      data: JSON.parse(r.data as string)
    };
    const key = `${r.kind}/${r.slug}`;
    byKey.set(key, row);
    map[key] = row;
  }
  const lookup: ContentLookup = (ref) => byKey.get(`${ref.kind}/${ref.slug}`);
  return { lookup, map, size: byKey.size };
}

/** Sets aren't JSON-serializable across the SvelteKit data boundary. */
export function serializeDerived(d: Derived) {
  return {
    ...d,
    stats: {
      ...d.stats,
      resistances: [...d.stats.resistances],
      immunities: [...d.stats.immunities],
      vulnerabilities: [...d.stats.vulnerabilities]
    },
    toggles: d.toggles
  };
}
