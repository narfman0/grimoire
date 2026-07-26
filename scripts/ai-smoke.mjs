#!/usr/bin/env node
// Env-gated live smoke test for the AI pipeline: one tiny structured-output
// call against the real API, validating key + model + parse pipeline.
//
// Deliberately uses the SDK directly (not the built server module) — this
// checks the external contract (ANTHROPIC_API_KEY, claude-opus-5,
// messages.parse + zodOutputFormat), not our wrapper. Run manually:
//
//   ANTHROPIC_API_KEY=sk-... node scripts/ai-smoke.mjs --live
//
// Without both the key and --live it exits 0 with a skip message, so it is
// safe to wire into any script pipeline.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const live = process.argv.includes('--live');
if (!process.env.ANTHROPIC_API_KEY || !live) {
  console.log(
    'ai-smoke: skipped (set ANTHROPIC_API_KEY and pass --live to run against the real API)'
  );
  process.exit(0);
}

const AI_MODEL = 'claude-opus-5';

const Answer = z.object({
  city: z.string(),
  country: z.string()
});

const client = new Anthropic();
const startedAt = Date.now();

try {
  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: 'Answer geography questions as structured data.',
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
    output_config: { format: zodOutputFormat(Answer), effort: 'low' }
  });

  if (response.stop_reason === 'refusal') {
    console.error('ai-smoke: FAIL — model refused the request');
    process.exit(1);
  }
  if (response.parsed_output == null) {
    console.error(`ai-smoke: FAIL — parsed_output null (stop_reason: ${response.stop_reason})`);
    process.exit(1);
  }

  console.log('ai-smoke: OK');
  console.log(`  model:               ${response.model}`);
  console.log(`  duration:            ${Date.now() - startedAt}ms`);
  console.log(`  input_tokens:        ${response.usage.input_tokens}`);
  console.log(`  output_tokens:       ${response.usage.output_tokens}`);
  console.log(`  cache_read_tokens:   ${response.usage.cache_read_input_tokens}`);
  console.log(`  cache_write_tokens:  ${response.usage.cache_creation_input_tokens}`);
  console.log(`  parsed_output:       ${JSON.stringify(response.parsed_output)}`);
} catch (err) {
  console.error('ai-smoke: FAIL —', err instanceof Error ? err.message : err);
  process.exit(1);
}
