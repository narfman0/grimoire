import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  conditionsForParticipant,
  toggleArrayValue,
  patchCharacterDocField,
  patchPcWithMirror
} from '../conditions';

describe('conditionsForParticipant', () => {
  it('returns the PC mirror entry for PCs', () => {
    expect(
      conditionsForParticipant(
        { id: 'p1', kind: 'pc', conditions: ['prone'] },
        { p1: ['blinded'] },
        ['poisoned']
      )
    ).toEqual(['blinded']);
  });

  it('returns [] for a PC missing from the mirror', () => {
    expect(
      conditionsForParticipant({ id: 'p1', kind: 'pc', conditions: ['prone'] }, {}, ['x'])
    ).toEqual([]);
    expect(
      conditionsForParticipant(
        { id: 'p1', kind: 'pc', conditions: ['prone'] },
        undefined,
        undefined
      )
    ).toEqual([]);
  });

  it('returns live conditions for non-PCs when present', () => {
    expect(
      conditionsForParticipant(
        { id: 'm1', kind: 'npc', conditions: ['prone'] },
        undefined,
        ['blinded']
      )
    ).toEqual(['blinded']);
  });

  it('falls back to SSR seed conditions for non-PCs when live is absent', () => {
    expect(
      conditionsForParticipant(
        { id: 'm1', kind: 'npc', conditions: ['prone'] },
        undefined,
        undefined
      )
    ).toEqual(['prone']);
  });
});

describe('toggleArrayValue', () => {
  it('adds a value not in the array (appended at the end)', () => {
    expect(toggleArrayValue(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });
  it('removes a value already in the array', () => {
    expect(toggleArrayValue(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
  it('preserves order of remaining entries', () => {
    expect(toggleArrayValue(['x', 'y', 'z', 'w'], 'z')).toEqual(['x', 'y', 'w']);
  });
  it('returns an empty array when removing the last entry', () => {
    expect(toggleArrayValue(['only'], 'only')).toEqual([]);
  });
  it('does not mutate the input', () => {
    const input = ['a', 'b'];
    toggleArrayValue(input, 'c');
    expect(input).toEqual(['a', 'b']);
  });
});

describe('patchCharacterDocField', () => {
  let originalFetch: typeof fetch;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GETs the doc, splices the field, PATCHes back', async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ document: { id: 'c1', name: 'Wiz', conditions: ['prone'] } }),
          { status: 200 }
        );
      }
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const ok = await patchCharacterDocField('c1', 'conditions', ['blinded']);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: '/api/characters/c1' });
    expect(calls[1]).toMatchObject({ url: '/api/characters/c1' });
    expect(calls[1].init?.method).toBe('PATCH');
    const sent = JSON.parse(calls[1].init?.body as string);
    expect(sent.document.conditions).toEqual(['blinded']);
    // Other fields preserved.
    expect(sent.document.name).toBe('Wiz');
    expect(sent.document.id).toBe('c1');
  });

  it('treats null document as empty (no merge crash)', async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ document: null }), { status: 200 });
      }
      calls.push({ url: String(url), init });
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const ok = await patchCharacterDocField('c1', 'conditions', ['blinded']);
    expect(ok).toBe(true);
    const sent = JSON.parse(calls[0].init?.body as string);
    expect(sent.document).toEqual({ conditions: ['blinded'] });
  });

  it('returns false on GET failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await patchCharacterDocField('c1', 'conditions', [])).toBe(false);
  });

  it('returns false on PATCH failure', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ document: {} }), { status: 200 });
      }
      return new Response('', { status: 500 });
    }) as typeof fetch;
    expect(await patchCharacterDocField('c1', 'conditions', [])).toBe(false);
  });

  it('returns false on network / parse exception', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as typeof fetch;
    expect(await patchCharacterDocField('c1', 'conditions', [])).toBe(false);
  });
});

describe('patchPcWithMirror', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('writes next optimistically then leaves it on PATCH success', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(JSON.stringify({ document: {} }), { status: 200 });
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const writes: Array<string[]> = [];
    const ok = await patchPcWithMirror<string[]>({
      characterId: 'c1',
      field: 'conditions',
      next: ['blinded'],
      prev: [],
      setLocal: (v) => writes.push(v)
    });
    expect(ok).toBe(true);
    expect(writes).toEqual([['blinded']]); // only the optimistic write
  });

  it('reverts to prev when PATCH fails', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(JSON.stringify({ document: {} }), { status: 200 });
      return new Response('', { status: 500 });
    }) as typeof fetch;

    const writes: Array<string[]> = [];
    const ok = await patchPcWithMirror<string[]>({
      characterId: 'c1',
      field: 'conditions',
      next: ['blinded'],
      prev: ['poisoned'],
      setLocal: (v) => writes.push(v)
    });
    expect(ok).toBe(false);
    expect(writes).toEqual([['blinded'], ['poisoned']]);
  });

  it('reverts when GET fails (never reached PATCH)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;
    const writes: Array<string[]> = [];
    const ok = await patchPcWithMirror<string[]>({
      characterId: 'c1',
      field: 'conditions',
      next: ['x'],
      prev: ['y'],
      setLocal: (v) => writes.push(v)
    });
    expect(ok).toBe(false);
    expect(writes).toEqual([['x'], ['y']]);
  });
});
