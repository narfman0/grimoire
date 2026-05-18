// Auth gate for /me/*. Anonymous visits bounce to /login with a redirect
// hint so we land them back here on success.

import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return { user: locals.user };
};
