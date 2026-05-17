import { error } from '@sveltejs/kit';
import { derive } from '$lib/rules';
import { PARTY } from '$lib/fixtures/party';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const entry = PARTY[params.slug as keyof typeof PARTY];
  if (!entry) throw error(404, 'no fixture with that slug');

  const { lookup } = await buildContentLookup();
  const derived = derive(entry.character, lookup);

  return {
    slug: entry.slug,
    label: entry.label,
    character: entry.character,
    derived: serializeDerived(derived),
    allSlugs: Object.keys(PARTY)
  };
};
