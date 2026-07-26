// Per-user AI quota — reuses the in-memory fixed-window limiter that backs
// auth rate limiting. 10 calls per hour per feature per user by default;
// routes catch AiQuotaError and return 429 (via handleAiError in ./http.ts).

import { isRateLimited } from '$lib/server/auth/rate-limit';
import { AiQuotaError } from './errors';

export const AI_QUOTA_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/** Throw AiQuotaError when `userId` has exceeded `max` calls of `feature`
 *  in the last hour. Call after auth + requireAiEnabled, before aiParse. */
export function assertAiQuota(userId: string, feature: string, max = AI_QUOTA_PER_HOUR): void {
  if (isRateLimited(`ai:${feature}:${userId}`, max, HOUR_MS)) {
    throw new AiQuotaError(feature);
  }
}
