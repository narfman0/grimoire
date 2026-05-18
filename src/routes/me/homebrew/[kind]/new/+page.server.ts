import { error } from '@sveltejs/kit';
import { HOMEBREW_KINDS } from '$lib/server/content/schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const kind = params.kind;
  if (!HOMEBREW_KINDS.includes(kind as (typeof HOMEBREW_KINDS)[number])) {
    throw error(404, `unknown content kind: ${kind}`);
  }
  if (kind === 'feat') throw error(404, 'use /me/homebrew/feats/new');
  return { kind };
};
