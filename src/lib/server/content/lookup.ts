// Server-side helpers for running the rules engine against DB-loaded content.
// The boot loader populates the `content` table; this builds an in-memory
// Map keyed by `${kind}/${slug}` for the engine's ContentLookup interface.

import { db, schema } from '$lib/server/db';
import type { ContentLookup, ContentRow, Derived } from '$lib/rules/types';

export async function buildContentLookup(): Promise<{
  lookup: ContentLookup;
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
  for (const r of rows) {
    byKey.set(`${r.kind}/${r.slug}`, {
      kind: r.kind,
      slug: r.slug,
      version: r.version,
      source: r.source,
      name: r.name,
      data: JSON.parse(r.data as string)
    });
  }
  const lookup: ContentLookup = (ref) => byKey.get(`${ref.kind}/${ref.slug}`);
  return { lookup, size: byKey.size };
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
