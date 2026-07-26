// HTTP glue for /api/ai/* routes: the feature-flag guard and the AiError →
// HTTP status mapping. See client.ts for the full route recipe.

import { error } from '@sveltejs/kit';
import { isAiEnabled } from './client';
import { AiError } from './errors';

/** Guard every /api/ai/* route calls first (after requireUser): 501 when
 *  ANTHROPIC_API_KEY is unset — the feature is dark, not broken. */
export function requireAiEnabled(): void {
  if (!isAiEnabled()) throw error(501, 'AI features are not configured');
}

/** Convert a thrown AiError into the SvelteKit HTTP error it maps to
 *  (501 not configured, 429 quota, 422 refusal, 502 parse/request,
 *  503 upstream unavailable); rethrow anything else as-is. */
export function handleAiError(err: unknown): never {
  if (err instanceof AiError) throw error(err.status, err.message);
  throw err;
}
