import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { loadAllPacks } from '$lib/server/content';
import { loadUserFromCookie } from '$lib/server/auth/sessions';

export const init: ServerInit = async () => {
  await loadAllPacks();
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await loadUserFromCookie(event.cookies);
  return resolve(event);
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  // Log every unhandled server error with enough context to diagnose it.
  // Replace this with a structured logger or error-tracking SDK (e.g. Sentry)
  // before shipping to production.
  if (status !== 404) {
    console.error('[server error]', {
      status,
      message,
      url: event.url.pathname,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
    });
  }
  // Return the safe public message SvelteKit exposes to the +error.svelte page.
  return { message };
};
