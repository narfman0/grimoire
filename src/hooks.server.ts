import type { Handle, ServerInit } from '@sveltejs/kit';
import { loadAllPacks } from '$lib/server/content';

export const init: ServerInit = async () => {
  await loadAllPacks();
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.displayName = event.cookies.get('grimoire_name') ?? null;
  return resolve(event);
};
