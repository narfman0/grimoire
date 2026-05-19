// Legacy route. The browse experience moved to /content/browse since it
// now surfaces SRD + future packs alongside homebrew. Forward query params
// so deep links into the marketplace keep working.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  throw redirect(308, `/content/browse${url.search}`);
};
