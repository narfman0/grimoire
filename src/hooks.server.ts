import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { loadAllPacks } from '$lib/server/content';
import { loadUserFromCookie, deleteExpiredSessions } from '$lib/server/auth/sessions';
import { closeDb, db, schema } from '$lib/server/db';

const SESSION_GC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export const init: ServerInit = async () => {
  await loadAllPacks();
  await deleteExpiredSessions();
  setInterval(() => { deleteExpiredSessions().catch(console.error); }, SESSION_GC_INTERVAL_MS);

  const adminUsername = process.env.ADMIN_USERNAME ?? 'narfman0';
  await db
    .update(schema.users)
    .set({ isAdmin: true })
    .where(eq(schema.users.username, adminUsername));

  const shutdown = () => { closeDb(); process.exit(0); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = await loadUserFromCookie(event.cookies);
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
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
