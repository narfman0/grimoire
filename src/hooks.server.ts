import type { Handle, ServerInit } from '@sveltejs/kit';
import { loadAllPacks } from '$lib/server/content';
import { loadUserFromCookie } from '$lib/server/auth/sessions';

export const init: ServerInit = async () => {
  await loadAllPacks();
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await loadUserFromCookie(event.cookies);
  return resolve(event);
};
