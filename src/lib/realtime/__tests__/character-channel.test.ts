// @vitest-environment jsdom
//
// character-channel guards on `typeof window !== 'undefined'` before
// starting its poll loop — same as encounter-channel, which gets jsdom via
// the environmentMatchGlobs entry in vitest.config.ts. This file opts in
// per-file so the glob there doesn't need widening.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { connectCharacter, type ConnectedDoc } from '../character-channel';
import type { CharacterDocument } from '$lib/rules/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Minimal stand-in documents — the channel treats the document as an opaque
 *  blob, so a couple of distinguishable shapes are all the tests need. */
function doc(name: string, currentHp: number): CharacterDocument {
  return { name, currentHp } as unknown as CharacterDocument;
}

describe('connectCharacter (polling)', () => {
  let originalFetch: typeof fetch;
  let conn: ConnectedDoc;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ document: doc('Polled', 10) })
    ) as typeof fetch;
  });

  afterEach(() => {
    conn?.destroy();
    globalThis.fetch = originalFetch;
    vi.clearAllTimers();
  });

  it('seeds the initial document from opts.seed', () => {
    const seed = doc('Seeded', 12);
    conn = connectCharacter({ characterId: 'chr-1', seed });
    expect(get(conn.document)).toEqual(seed);
  });

  it('updates the document and flips status to "open" after a successful poll', async () => {
    conn = connectCharacter({ characterId: 'chr-1', seed: doc('Seeded', 12) });
    await new Promise((r) => setTimeout(r, 0));
    expect(get(conn.document)).toEqual(doc('Polled', 10));
    expect(get(conn.status)).toBe('open');
  });

  it('destroy() sets status to closed', () => {
    conn = connectCharacter({ characterId: 'chr-1' });
    conn.destroy();
    expect(get(conn.status)).toBe('closed');
  });

  // --- stale-poll guard ----------------------------------------------------
  // The race: a poll is issued, then the page PATCHes the document (calling
  // noteMutation), and the poll — carrying the pre-PATCH document — resolves
  // after the PATCH succeeded. Applying it would revert the local edit until
  // the next poll. The guard must drop that payload.
  it('drops a stale poll response issued before a noteMutation()-signalled PATCH', async () => {
    const seed = doc('Seeded', 12);
    let resolveStalePoll!: (r: Response) => void;
    const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return stalePoll; // first poll hangs until released
      return jsonResponse({ document: doc('Post-patch', 5) });
    }) as typeof fetch;

    conn = connectCharacter({ characterId: 'chr-1', seed });
    // Poll #1 in flight. The page starts a PATCH and signals it.
    const patch = Promise.resolve(); // simulated successful PATCH
    conn.noteMutation(patch);
    await patch;
    await new Promise((r) => setTimeout(r, 0));

    // Stale poll resolves with the pre-PATCH document.
    resolveStalePoll(jsonResponse({ document: doc('Stale-pre-patch', 12) }));
    await new Promise((r) => setTimeout(r, 0));

    // The store must NOT be clobbered by the stale snapshot.
    expect(get(conn.document)).toEqual(seed);
    // Dropping a stale payload is not a connection error.
    expect(get(conn.status)).toBe('open');
  });

  it('drops a poll response that resolves while the PATCH is still in flight', async () => {
    const seed = doc('Seeded', 12);
    let resolveStalePoll!: (r: Response) => void;
    const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return stalePoll;
      return jsonResponse({ document: doc('Post-patch', 5) });
    }) as typeof fetch;

    conn = connectCharacter({ characterId: 'chr-1', seed });
    let settlePatch!: () => void;
    const patch = new Promise<void>((r) => { settlePatch = r; });
    conn.noteMutation(patch);

    // Poll resolves while the PATCH is unresolved — must be dropped.
    resolveStalePoll(jsonResponse({ document: doc('Stale-mid-patch', 12) }));
    await new Promise((r) => setTimeout(r, 0));
    expect(get(conn.document)).toEqual(seed);

    settlePatch();
    await new Promise((r) => setTimeout(r, 0));
    expect(get(conn.document)).toEqual(seed); // still untouched
  });

  // Polls must not starve: after the PATCH settles (quiescence), the next
  // poll's payload — now reflecting the committed mutation — must apply.
  it('applies the next poll after quiescence', async () => {
    vi.useFakeTimers();
    try {
      let serverDoc = doc('Original', 12);
      globalThis.fetch = vi.fn(async () =>
        jsonResponse({ document: serverDoc })
      ) as typeof fetch;

      conn = connectCharacter({ characterId: 'chr-1', seed: doc('Seeded', 12) });
      await vi.advanceTimersByTimeAsync(0); // flush the first poll
      expect(get(conn.document)).toEqual(doc('Original', 12));

      // Page PATCHes; the server commits before the promise settles.
      const patch = Promise.resolve().then(() => {
        serverDoc = doc('Patched', 5);
      });
      conn.noteMutation(patch);
      await vi.advanceTimersByTimeAsync(0);

      // Next interval poll after quiescence applies the fresh server state.
      await vi.advanceTimersByTimeAsync(2000);
      expect(get(conn.document)).toEqual(doc('Patched', 5));
    } finally {
      vi.useRealTimers();
    }
  });

  it('noteMutation() without a promise still guards polls issued before it', async () => {
    const seed = doc('Seeded', 12);
    let resolveStalePoll!: (r: Response) => void;
    const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return stalePoll;
      return jsonResponse({ document: doc('Fresh', 5) });
    }) as typeof fetch;

    conn = connectCharacter({ characterId: 'chr-1', seed });
    conn.noteMutation(); // fire-and-forget signal, no promise
    resolveStalePoll(jsonResponse({ document: doc('Stale', 12) }));
    await new Promise((r) => setTimeout(r, 0));
    expect(get(conn.document)).toEqual(seed);
  });
});
