// Server-side helpers for running the rules engine against DB-loaded content.
// The boot loader populates the `content` table; this builds an in-memory
// Map keyed by `${kind}/${slug}` for the engine's ContentLookup interface.

import { db, schema } from '$lib/server/db';
import type { ContentLookup, ContentRow, Derived } from '$lib/rules/types';

/**
 * Build the content lookup the rules engine uses to resolve ContentRefs.
 *
 * When `ownerUserId` is provided, that user's homebrew row wins any slug
 * collision against a global pack row — homebrew is intentional override of
 * what the catalog ships. When omitted, only globally-scoped rows are
 * visible. Other users' homebrew is never returned.
 */
export async function buildContentLookup(ownerUserId?: string): Promise<{
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
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content);

  const byKey = new Map<string, ContentRow>();
  const ownership = new Map<string, string | null>();
  const map: Record<string, ContentRow> = {};
  for (const r of rows) {
    // Skip other users' homebrew entirely — those rows aren't visible from
    // this lookup context.
    if (r.ownerUserId !== null && r.ownerUserId !== (ownerUserId ?? '__none__')) continue;

    const key = `${r.kind}/${r.slug}`;
    // Don't let a global row clobber the requesting user's homebrew row
    // already in the map.
    const prev = ownership.get(key);
    if (prev !== undefined && prev !== null && r.ownerUserId === null) continue;

    const row: ContentRow = {
      kind: r.kind,
      slug: r.slug,
      version: r.version,
      source: r.source,
      name: r.name,
      data: JSON.parse(r.data as string)
    };
    byKey.set(key, row);
    map[key] = row;
    ownership.set(key, r.ownerUserId);
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
