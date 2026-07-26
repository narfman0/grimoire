// aiParse — the one helper every AI feature calls.
//
// Wraps client.messages.parse() with structured outputs (zodOutputFormat):
// the same Zod schemas the REST API validates with are the LLM contract, so
// a response that parses is by construction importable. Handles refusals,
// parse failures, and SDK exceptions by mapping them onto the typed AiError
// union in ./errors.ts, and logs usage for every call (this IS the usage
// tracking for now — structured logs, no table).

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { logger } from '$lib/server/logger';
import { AI_MODEL, getAiClient } from './client';
import { AiError, AiParseError, AiRefusalError, AiRequestError, AiUnavailableError } from './errors';

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiParseOptions<T> {
  /** Feature name for usage logging + error messages (e.g. 'ingest-map'). */
  feature: string;
  /** Static system prompt — keep byte-identical per feature; it is sent with
   *  cache_control so repeat calls hit the prompt cache. Volatile content
   *  belongs in `content`. */
  system: string;
  /** User content: a plain string, or an array of content blocks for vision
   *  input — e.g. `{type: 'image', source: {type: 'base64', media_type, data}}`
   *  followed by text blocks. */
  content: string | Anthropic.Messages.ContentBlockParam[];
  /** Zod schema for the structured output. */
  schema: z.ZodType<T>;
  /** output_config.effort (default 'medium'). */
  effort?: AiEffort;
  /** Output token cap (default 16000). */
  maxTokens?: number;
}

/** Map SDK exceptions to the AiError union, most-specific-first. Anything
 *  unrecognized is returned unchanged so unexpected bugs still surface. */
function mapSdkError(err: unknown): unknown {
  if (err instanceof Anthropic.RateLimitError) return new AiUnavailableError(); // upstream 429 → 503
  // APIConnectionError is a subclass of APIError in the TS SDK — check first.
  if (err instanceof Anthropic.APIConnectionError) return new AiUnavailableError();
  if (err instanceof Anthropic.InternalServerError) return new AiUnavailableError(); // 5xx/529
  if (err instanceof Anthropic.APIError) {
    return new AiRequestError(`${err.status ?? '?'} ${err.message}`);
  }
  return err;
}

/**
 * Run one structured-output call against AI_MODEL and return the parsed
 * object. Throws members of the AiError union on any failure — routes map
 * them to HTTP via handleAiError() in ./http.ts.
 */
export async function aiParse<T>(opts: AiParseOptions<T>): Promise<T> {
  const client = getAiClient(); // AiNotConfiguredError when key unset
  const startedAt = Date.now();

  let response: Awaited<ReturnType<typeof client.messages.parse>>;
  try {
    response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 16_000,
      // Static system prompt behind a cache breakpoint — prompt caching.
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.content }],
      output_config: {
        format: zodOutputFormat(opts.schema),
        effort: opts.effort ?? 'medium'
      }
    });
  } catch (err) {
    const mapped = mapSdkError(err);
    logger.warn(
      {
        feature: opts.feature,
        model: AI_MODEL,
        duration_ms: Date.now() - startedAt,
        err: mapped instanceof AiError ? mapped.message : mapped
      },
      'ai call failed'
    );
    throw mapped;
  }

  // Usage log — every call, success or refusal. This is the cost-visibility
  // record until a usage table exists.
  logger.info(
    {
      feature: opts.feature,
      model: AI_MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
      stop_reason: response.stop_reason,
      duration_ms: Date.now() - startedAt
    },
    'ai call'
  );

  // Refusal FIRST — content may be empty or partial; never touch it.
  if (response.stop_reason === 'refusal') {
    throw new AiRefusalError(opts.feature);
  }
  if (response.parsed_output == null) {
    throw new AiParseError(opts.feature, response.stop_reason);
  }
  return response.parsed_output as T;
}
