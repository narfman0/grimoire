import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { ContentLookup, ContentRow } from '$lib/rules/types';
import { PARTY } from '$lib/fixtures/party';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const entry = PARTY[params.slug as keyof typeof PARTY];
  if (!entry) throw error(404, 'no fixture with that slug');

  // Load all content rows from the DB into an in-memory map keyed by
  // `${kind}/${slug}`. v0 grimoire DB tops out around ~50 rows; the full
  // table read is cheap. Add kind-filtered queries when scale demands.
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

  const derived = derive(entry.character, lookup);

  return {
    slug: entry.slug,
    label: entry.label,
    character: entry.character,
    derived: serializeDerived(derived),
    allSlugs: Object.keys(PARTY)
  };
};

// Sets aren't JSON-serializable across the SvelteKit boundary — convert to arrays.
function serializeDerived(d: ReturnType<typeof derive>) {
  return {
    ...d,
    stats: {
      ...d.stats,
      resistances: [...d.stats.resistances],
      immunities: [...d.stats.immunities],
      vulnerabilities: [...d.stats.vulnerabilities]
    }
  };
}
