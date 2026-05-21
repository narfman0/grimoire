import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  tracesSampleRate: import.meta.env.PROD ? 0.1 : 0
});
