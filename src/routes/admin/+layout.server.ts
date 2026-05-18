// /admin/* gate. Only users.is_admin = true reach any /admin route.
// Promote a user via SQL:  UPDATE users SET is_admin = 1 WHERE username = '<you>';

import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  }
  if (!locals.user.isAdmin) throw error(403, 'admin only');
  return { user: locals.user };
};
