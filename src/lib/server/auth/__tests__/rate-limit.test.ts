import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRateLimited, rateLimitMax, resetRateLimitState } from '../rate-limit';

const ENV_KEY = 'AUTH_RATE_LIMIT_SIGNUP';

describe('isRateLimited', () => {
  beforeEach(() => resetRateLimitState());

  it('allows up to max within the window, then blocks', () => {
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited('k', 3, 60_000)).toBe(false);
    }
    expect(isRateLimited('k', 3, 60_000)).toBe(true);
  });

  it('scopes buckets by key', () => {
    expect(isRateLimited('a', 1, 60_000)).toBe(false);
    expect(isRateLimited('a', 1, 60_000)).toBe(true);
    expect(isRateLimited('b', 1, 60_000)).toBe(false);
  });

  it('starts a fresh bucket once the window has elapsed', () => {
    expect(isRateLimited('k', 1, -1)).toBe(false);
    // resetAt is already in the past, so the next call re-opens the bucket.
    expect(isRateLimited('k', 1, -1)).toBe(false);
  });
});

describe('rateLimitMax', () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => resetRateLimitState());
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('returns the policy default when unset', () => {
    delete process.env[ENV_KEY];
    expect(rateLimitMax('signup', 5)).toBe(5);
  });

  it('returns the policy default for an empty value', () => {
    process.env[ENV_KEY] = '';
    expect(rateLimitMax('signup', 5)).toBe(5);
  });

  it('honours a positive integer override', () => {
    process.env[ENV_KEY] = '1000';
    expect(rateLimitMax('signup', 5)).toBe(1000);
  });

  it.each(['0', '-1', 'abc', '2.5'])('ignores the invalid override %s', (value) => {
    process.env[ENV_KEY] = value;
    expect(rateLimitMax('signup', 5)).toBe(5);
  });

  it('maps a hyphenated limiter name onto its env var', () => {
    process.env.AUTH_RATE_LIMIT_RESEND_VERIFY = '42';
    try {
      expect(rateLimitMax('resend-verify', 3)).toBe(42);
    } finally {
      delete process.env.AUTH_RATE_LIMIT_RESEND_VERIFY;
    }
  });
});
