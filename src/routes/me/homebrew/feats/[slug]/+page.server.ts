// Legacy route. Feats are edited via the generic /me/homebrew/[kind]/[slug]
// page now.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/me/homebrew/feat/${encodeURIComponent(params.slug)}`);
};
