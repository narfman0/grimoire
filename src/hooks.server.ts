import * as Sentry from '@sentry/sveltekit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { eq } from 'drizzle-orm';
import { seedSrdIfMissing } from '$lib/server/content';
import { loadUserFromCookie, deleteExpiredSessions } from '$lib/server/auth/sessions';
import { closeDb, db, schema } from '$lib/server/db';
import { logger } from '$lib/server/logger';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0
});

const SESSION_GC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export const init: ServerInit = async () => {
  // First-boot SRD seed only. Non-SRD content is imported by the operator
  // via POST /api/homebrew/import after the server is up (see
  // docs/content-distribution.md).
  await seedSrdIfMissing();
  await deleteExpiredSessions();
  setInterval(() => {
    deleteExpiredSessions().catch((err) => logger.error({ err }, 'session GC failed'));
  }, SESSION_GC_INTERVAL_MS);

  const adminUsername = process.env.ADMIN_USERNAME ?? 'narfman0';
  await db
    .update(schema.users)
    .set({ isAdmin: true })
    .where(eq(schema.users.username, adminUsername));

  const shutdown = () => {
    // Brief drain window for in-flight requests before closing the DB
    setTimeout(() => { closeDb(); process.exit(0); }, 5000);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

const appHandle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID();
  event.locals.user = await loadUserFromCookie(event.cookies);
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};

export const handle: Handle = sequence(Sentry.sentryHandle(), appHandle);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  if (status !== 404) {
    const log = logger.child({
      requestId: event.locals?.requestId,
      userId: event.locals?.user?.id,
      url: event.url.pathname,
      status
    });
    log.error(
      {
        err: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error
      },
      message
    );
    if (status >= 500 && error instanceof Error) {
      Sentry.withScope((scope) => {
        scope.setTag('requestId', event.locals?.requestId ?? 'unknown');
        scope.setUser({ id: event.locals?.user?.id });
        Sentry.captureException(error);
      });
    }
  }
  return { message, requestId: event.locals?.requestId };
};
