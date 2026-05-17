import type { LayoutServerLoad } from './$types';

// Make `data.user` available in every page + layout. /login and /signup
// render auth forms even when user is null; everything else can rely on it.
export const load: LayoutServerLoad = async ({ locals }) => {
  return { user: locals.user };
};
