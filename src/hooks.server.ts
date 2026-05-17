import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.displayName = event.cookies.get('grimoire_name') ?? null;
  return resolve(event);
};
