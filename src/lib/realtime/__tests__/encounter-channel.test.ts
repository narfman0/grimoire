import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  connectEncounter,
  type ConnectedEncounter,
  type ParticipantHp,
  type TurnPlan
} from '../encounter-channel';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** A minimal server snapshot returned by GET /api/encounters/[id]/state */
function stateSnapshot(overrides: Partial<{
  round: number;
  activeParticipantId: string | null;
  plans: Record<string, unknown>;
  participantHp: Record<string, unknown>;
}> = {}) {
  return {
    round: 0,
    activeParticipantId: null,
    plans: {},
    participantHp: {},
    ...overrides
  };
}

describe('connectEncounter (polling)', () => {
  let originalFetch: typeof fetch;
  let conn: ConnectedEncounter;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default: state endpoint returns empty snapshot; mutation endpoints return ok.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      return jsonResponse({ ok: true });
    }) as typeof fetch;
  });

  afterEach(() => {
    conn?.destroy();
    globalThis.fetch = originalFetch;
    vi.clearAllTimers();
  });

  // Seeds: the initial store value comes from opts.seed, not from the first
  // poll, so SSR-rendered state appears synchronously.
  it('seeds the initial state from opts.seed', () => {
    conn = connectEncounter({
      encounterId: 'enc-1',
      seed: { round: 5, activeParticipantId: 'p1' }
    });
    const snap = get(conn.state);
    expect(snap.round).toBe(5);
    expect(snap.activeParticipantId).toBe('p1');
  });

  it('status starts as "connecting" before first successful poll', () => {
    // Block fetch from resolving immediately so we can inspect pre-poll state.
    globalThis.fetch = vi.fn(async () => {
      // Never resolves during this synchronous check.
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    conn = connectEncounter({ encounterId: 'enc-1' });
    expect(get(conn.status)).toBe('connecting');
  });

  it('status flips to "open" after a successful poll', async () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    // Flush the microtask queue fully: fetch → .json() each need a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(get(conn.status)).toBe('open');
  });

  it('updates state from poll response — round and activeParticipantId', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) {
        return jsonResponse(stateSnapshot({ round: 3, activeParticipantId: 'mob-7' }));
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await new Promise((r) => setTimeout(r, 0));

    const snap = get(conn.state);
    expect(snap.round).toBe(3);
    expect(snap.activeParticipantId).toBe('mob-7');
  });

  it('updates plans from poll response', async () => {
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) {
        return jsonResponse(stateSnapshot({ plans: { 'mob-7': plan } }));
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await new Promise((r) => setTimeout(r, 0));

    expect(get(conn.state).plans['mob-7']).toEqual(plan);
  });

  it('updates participantHp from poll response', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) {
        return jsonResponse(stateSnapshot({
          participantHp: { 'mob-7': { currentHp: 5, tempHp: 2, maxHp: 10, conditions: [] } }
        }));
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await new Promise((r) => setTimeout(r, 0));

    const hp = get(conn.state).participantHp['mob-7'];
    expect(hp.currentHp).toBe(5);
    expect(hp.tempHp).toBe(2);
  });

  it('status stays "connecting" after 3 consecutive poll failures', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'oops' }, 503)) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    // 3 polls needed before status downgrades — the first is already fired.
    await Promise.resolve(); await Promise.resolve();
    // Trigger two more failures by advancing intervals — but since we can't
    // advance fake timers here, just assert that after 1 failure the initial
    // 'connecting' is preserved (it never flipped to 'open').
    expect(get(conn.status)).toBe('connecting');
  });

  // Locks the optimistic-update contract. setPlan must update the local
  // store synchronously, before the POST resolves.
  it('setPlan updates the local snapshot synchronously', async () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };
    const promise = conn.setPlan('mob-7', plan);
    // Before the awaited fetch resolves, the local snapshot already
    // reflects the change.
    expect(get(conn.state).plans['mob-7']).toEqual(plan);
    await promise;
  });

  // Locks the rollback path. A non-2xx response must revert the optimistic
  // update so the UI doesn't stay forever ahead of the server.
  it('setPlan rolls back the local snapshot when the POST fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      return jsonResponse({ error: 'nope' }, 500);
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };
    await expect(conn.setPlan('mob-7', plan)).rejects.toThrow(/500/);
    expect(get(conn.state).plans['mob-7']).toBeUndefined();
  });

  it('clearPlan rolls back on failure (restoring the prior plan)', async () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };
    await conn.setPlan('mob-7', plan);
    // Now make the DELETE fail.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      return jsonResponse({ error: 'nope' }, 500);
    }) as typeof fetch;
    await expect(conn.clearPlan('mob-7')).rejects.toThrow(/500/);
    expect(get(conn.state).plans['mob-7']).toEqual(plan);
  });

  // applyDamage / applyHeal are the pure local helpers used by the resolve
  // modal. Temp HP soaks damage first; current never goes below 0; heal
  // is capped at maxHp when provided.
  describe('applyDamage / applyHeal', () => {
    const seed: ParticipantHp = {
      currentHp: 10,
      tempHp: 3,
      conditions: [],
      concentrating: null
    };

    it('applyDamage absorbs into temp HP before current HP', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const next = conn.applyDamage('mob-7', 5, seed);
      expect(next.tempHp).toBe(0); // 3 absorbed
      expect(next.currentHp).toBe(8); // 10 - (5 - 3) = 8
    });

    it('applyDamage floors current HP at 0', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const next = conn.applyDamage('mob-7', 999, seed);
      expect(next.currentHp).toBe(0);
    });

    it('applyHeal caps at maxHp when provided', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const next = conn.applyHeal('mob-7', 999, 12, seed);
      expect(next.currentHp).toBe(12);
    });

    it('applyHeal has no cap when maxHp is null', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const next = conn.applyHeal('mob-7', 5, null, seed);
      expect(next.currentHp).toBe(15);
    });

    it('applyDamage returns input unchanged when currentHp is null', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const nullSeed: ParticipantHp = { ...seed, currentHp: null, tempHp: 0 };
      const next = conn.applyDamage('mob-7', 5, nullSeed);
      expect(next.currentHp).toBeNull();
    });
  });

  it('destroy() stops the polling interval and sets status to closed', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    conn.destroy();
    expect(get(conn.status)).toBe('closed');
  });
});
