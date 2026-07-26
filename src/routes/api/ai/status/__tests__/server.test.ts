// Tests for GET /api/ai/status — the AI feature flag endpoint.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  username: 'alice',
  isAdmin: false,
  email: null,
  emailVerified: false
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/ai/status', () => {
  it('requires login (401)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    await expectHttpError(GET(makeEvent({ user: null })), 401);
  });

  it('reports disabled with null model when ANTHROPIC_API_KEY is unset', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await GET(makeEvent({ user }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, model: null });
  });

  it('reports enabled with the model when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const res = await GET(makeEvent({ user }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, model: 'claude-opus-5' });
  });
});
