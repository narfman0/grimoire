// Legacy route. Feats are authored via the generic /me/homebrew/[kind]/new
// page now.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(308, '/me/homebrew/feat/new');
};
