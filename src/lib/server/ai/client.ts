// AI foundation — Anthropic client singleton + feature flag.
//
// The API key (ANTHROPIC_API_KEY) is read from the environment at first use,
// never at module load, so tests and keyless deployments import this module
// freely. When the key is unset every AI feature is dark: `isAiEnabled()`
// is false, routes 501, and the UI hides its entry points.
//
// Route recipe — every /api/ai/* endpoint follows the same shape:
//
//   export const POST: RequestHandler = async ({ locals, request }) => {
//     const user = requireUser(locals);          // 401 when logged out
//     requireAiEnabled();                        // 501 when key unset (http.ts)
//     assertAiQuota(user.id, 'ingest-map');      // 429 past 10/hour (rate-limit.ts)
//     const input = await parseJson(request, MyRequestSchema);
//     try {
//       const draft = await aiParse({            // call.ts — the one helper
//         feature: 'ingest-map',
//         system: STATIC_SYSTEM_PROMPT,          // static per feature → prompt-cached
//         content: [ ...image/text blocks... ],  // volatile content goes here
//         schema: ZoneGraphSchema                // same Zod schema the REST API uses
//       });
//       return json({ draft });
//     } catch (err) {
//       handleAiError(err);                      // AiError union → HTTP status
//     }
//   };
//
// Keep system prompts static per feature (byte-identical across calls) —
// they are sent with cache_control so repeat calls hit the prompt cache.

import Anthropic from '@anthropic-ai/sdk';
import { AiNotConfiguredError } from './errors';

/** The single model constant every AI feature uses. */
export const AI_MODEL = 'claude-opus-5';

/** True when ANTHROPIC_API_KEY is set — AI features are live. */
export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

/** Lazily-constructed singleton. The SDK reads ANTHROPIC_API_KEY from the
 *  environment itself; we only gate on presence. Throws AiNotConfiguredError
 *  when the key is unset. */
export function getAiClient(): Anthropic {
  if (!isAiEnabled()) throw new AiNotConfiguredError();
  if (!client) client = new Anthropic();
  return client;
}

/** Test-only: drop the cached client so env stubs take effect. */
export function _resetAiClientForTests(): void {
  client = null;
}
