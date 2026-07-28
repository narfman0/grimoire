import { logger } from '$lib/server/logger';

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

function maybeCleanup() {
  if (store.size > 10_000) {
    const now = Date.now();
    for (const [key, bucket] of store) {
      if (now >= bucket.resetAt) store.delete(key);
    }
  }
}

const overrideLogged = new Set<string>();

/** Ceiling for a named auth limiter, overridable via
 *  `AUTH_RATE_LIMIT_<NAME>` (e.g. `AUTH_RATE_LIMIT_SIGNUP`).
 *
 *  The defaults passed by call sites are the production policy. The
 *  override exists because a full e2e run signs up more accounts from a
 *  single address than any real client would, and the suite would
 *  otherwise have to stay under a limit that has nothing to do with what
 *  it is testing. Overrides are logged once per limiter so a
 *  misconfigured deploy is visible rather than silent; an unparseable or
 *  non-positive value is ignored in favour of the default. */
export function rateLimitMax(name: string, fallback: number): number {
  const raw = process.env[`AUTH_RATE_LIMIT_${name.toUpperCase().replace(/-/g, '_')}`];
  if (raw == null || raw === '') return fallback;

  const parsed = Number(raw);
  const valid = Number.isInteger(parsed) && parsed > 0;
  if (!overrideLogged.has(name)) {
    overrideLogged.add(name);
    if (valid) {
      logger.warn(
        { limiter: name, max: parsed, policyDefault: fallback },
        'auth rate limit raised by AUTH_RATE_LIMIT_* env override'
      );
    } else {
      logger.warn(
        { limiter: name, value: raw, policyDefault: fallback },
        'ignoring invalid AUTH_RATE_LIMIT_* override'
      );
    }
  }
  return valid ? parsed : fallback;
}

/** Test seam — the override warning fires once per process, which would
 *  make assertions order-dependent. */
export function resetRateLimitState(): void {
  store.clear();
  overrideLogged.clear();
}

export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  maybeCleanup();
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (bucket.count >= max) return true;
  bucket.count++;
  return false;
}
