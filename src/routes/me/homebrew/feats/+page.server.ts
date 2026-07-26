// Legacy route. Feats are managed by the generic /me/homebrew/[kind] pages
// now (same pattern as /homebrew/browse -> /content/browse).

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(308, '/me/homebrew/feat');
};
