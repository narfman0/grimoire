// Unit tests for the AI foundation module. The Anthropic SDK is mocked —
// no network — but zodOutputFormat (a pure helper on an unmocked subpath)
// runs for real, so the structured-output plumbing is exercised.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number | undefined;
    constructor(message = 'api error', status?: number) {
      super(message);
      this.status = status;
    }
  }
  class APIConnectionError extends APIError {
    constructor() {
      super('connection failed');
    }
  }
  class RateLimitError extends APIError {
    constructor() {
      super('rate limited', 429);
    }
  }
  class InternalServerError extends APIError {
    constructor() {
      super('overloaded', 529);
    }
  }
  class MockAnthropic {
    messages = { parse: parseMock };
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
  }
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '$lib/server/logger';
import { AI_MODEL, isAiEnabled, getAiClient, _resetAiClientForTests } from '../client';
import { aiParse } from '../call';
import { assertAiQuota } from '../rate-limit';
import {
  AiNotConfiguredError,
  AiQuotaError,
  AiRefusalError,
  AiParseError,
  AiRequestError,
  AiUnavailableError
} from '../errors';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MockErrors = Anthropic as any;

const Answer = z.object({ city: z.string() });

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: 'end_turn',
    parsed_output: { city: 'Paris' },
    usage: {
      input_tokens: 120,
      output_tokens: 34,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 20
    },
    ...overrides
  };
}

beforeEach(() => {
  parseMock.mockReset();
  _resetAiClientForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('client (key unset)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });

  it('isAiEnabled is false and getAiClient throws AiNotConfiguredError', () => {
    expect(isAiEnabled()).toBe(false);
    expect(() => getAiClient()).toThrow(AiNotConfiguredError);
  });

  it('aiParse throws AiNotConfiguredError without touching the SDK', async () => {
    await expect(
      aiParse({ feature: 'test', system: 's', content: 'c', schema: Answer })
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe('aiParse (key set)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  it('success path returns the parsed object and logs usage', async () => {
    parseMock.mockResolvedValueOnce(okResponse());
    const infoSpy = vi.spyOn(logger, 'info');

    const out = await aiParse({
      feature: 'test-feature',
      system: 'static system prompt',
      content: 'user text',
      schema: Answer
    });

    expect(out).toEqual({ city: 'Paris' });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'test-feature',
        model: AI_MODEL,
        input_tokens: 120,
        output_tokens: 34,
        cache_read_input_tokens: 100,
        stop_reason: 'end_turn',
        duration_ms: expect.any(Number)
      }),
      'ai call'
    );
  });

  it('sends model, cached system block, effort default, and max_tokens default', async () => {
    parseMock.mockResolvedValueOnce(okResponse());
    await aiParse({ feature: 'test', system: 'sys', content: 'c', schema: Answer });

    expect(parseMock).toHaveBeenCalledTimes(1);
    const params = parseMock.mock.calls[0][0];
    expect(params.model).toBe(AI_MODEL);
    expect(params.max_tokens).toBe(16_000);
    expect(params.system).toEqual([
      { type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }
    ]);
    expect(params.output_config.effort).toBe('medium');
    // zodOutputFormat ran for real — a JSON-schema output format is attached.
    expect(params.output_config.format).toBeTruthy();
    expect(params.messages).toEqual([{ role: 'user', content: 'c' }]);
  });

  it('passes through effort/maxTokens overrides and vision content blocks', async () => {
    parseMock.mockResolvedValueOnce(okResponse());
    const blocks = [
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'aWJt' }
      },
      { type: 'text' as const, text: 'what is on this map?' }
    ];
    await aiParse({
      feature: 'test',
      system: 'sys',
      content: blocks,
      schema: Answer,
      effort: 'high',
      maxTokens: 4096
    });

    const params = parseMock.mock.calls[0][0];
    expect(params.output_config.effort).toBe('high');
    expect(params.max_tokens).toBe(4096);
    expect(params.messages).toEqual([{ role: 'user', content: blocks }]);
  });

  it('refusal stop_reason throws AiRefusalError even when content is empty', async () => {
    parseMock.mockResolvedValueOnce(okResponse({ stop_reason: 'refusal', parsed_output: null }));
    const err = await aiParse({
      feature: 'test',
      system: 's',
      content: 'c',
      schema: Answer
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiRefusalError);
    expect(err.status).toBe(422);
  });

  it('null parsed_output throws AiParseError', async () => {
    parseMock.mockResolvedValueOnce(okResponse({ parsed_output: null }));
    const err = await aiParse({
      feature: 'test',
      system: 's',
      content: 'c',
      schema: Answer
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiParseError);
    expect(err.status).toBe(502);
  });

  it('maps RateLimitError to AiUnavailableError (503)', async () => {
    parseMock.mockRejectedValueOnce(new MockErrors.RateLimitError());
    const err = await aiParse({
      feature: 'test',
      system: 's',
      content: 'c',
      schema: Answer
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.status).toBe(503);
  });

  it('maps APIConnectionError and InternalServerError to AiUnavailableError', async () => {
    parseMock.mockRejectedValueOnce(new MockErrors.APIConnectionError());
    await expect(
      aiParse({ feature: 'test', system: 's', content: 'c', schema: Answer })
    ).rejects.toBeInstanceOf(AiUnavailableError);

    parseMock.mockRejectedValueOnce(new MockErrors.InternalServerError());
    await expect(
      aiParse({ feature: 'test', system: 's', content: 'c', schema: Answer })
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('maps other APIErrors to AiRequestError (502)', async () => {
    parseMock.mockRejectedValueOnce(new MockErrors.APIError('bad request', 400));
    const err = await aiParse({
      feature: 'test',
      system: 's',
      content: 'c',
      schema: Answer
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.status).toBe(502);
  });

  it('rethrows unrecognized errors unchanged', async () => {
    const boom = new TypeError('bug in our code');
    parseMock.mockRejectedValueOnce(boom);
    await expect(
      aiParse({ feature: 'test', system: 's', content: 'c', schema: Answer })
    ).rejects.toBe(boom);
  });
});

describe('assertAiQuota', () => {
  it('allows 10 calls per hour per feature, then throws AiQuotaError (429)', () => {
    const userId = crypto.randomUUID();
    for (let i = 0; i < 10; i++) {
      expect(() => assertAiQuota(userId, 'quota-test')).not.toThrow();
    }
    let err: unknown;
    try {
      assertAiQuota(userId, 'quota-test');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AiQuotaError);
    expect((err as AiQuotaError).status).toBe(429);
  });

  it('quota is scoped per feature and per user', () => {
    const userId = crypto.randomUUID();
    for (let i = 0; i < 10; i++) assertAiQuota(userId, 'feature-a');
    // Different feature and different user are unaffected.
    expect(() => assertAiQuota(userId, 'feature-b')).not.toThrow();
    expect(() => assertAiQuota(crypto.randomUUID(), 'feature-a')).not.toThrow();
  });
});
