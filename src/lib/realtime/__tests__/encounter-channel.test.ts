import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  connectEncounter,
  type ConnectedEncounter,
  type ParticipantHp,
  type TurnPlan
} from '../encounter-channel';

/** Fake EventSource that captures the instance + lets the test fire
 *  events synthetically. The real one in jsdom won't reach a server. */
class FakeEventSource implements Partial<EventSource> {
  static last: FakeEventSource | null = null;
  url: string;
  onopen: ((this: EventSource, ev: Event) => void) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
  onerror: ((this: EventSource, ev: Event) => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  /** Test helper to push a message into the channel as if from the server. */
  emit(data: unknown) {
    this.onmessage?.call(this as unknown as EventSource, {
      data: typeof data === 'string' ? data : JSON.stringify(data)
    } as MessageEvent);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('connectEncounter', () => {
  let originalES: typeof EventSource;
  let originalFetch: typeof fetch;
  let conn: ConnectedEncounter;

  beforeEach(() => {
    originalES = globalThis.EventSource;
    originalFetch = globalThis.fetch;
    // @ts-expect-error — assigning a stand-in EventSource implementation
    globalThis.EventSource = FakeEventSource;
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof fetch;
  });

  afterEach(() => {
    conn?.destroy();
    globalThis.EventSource = originalES;
    globalThis.fetch = originalFetch;
    FakeEventSource.last = null;
  });

  // Locks: seed snapshot is the starting state — used to avoid first-paint
  // flash before SSE arrives.
  it('seeds the initial state from opts.seed', () => {
    conn = connectEncounter({
      encounterId: 'enc-1',
      seed: { round: 5, activeParticipantId: 'p1' }
    });
    const snap = get(conn.state);
    expect(snap.round).toBe(5);
    expect(snap.activeParticipantId).toBe('p1');
  });

  it('opens an EventSource to the encounter stream URL', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    expect(FakeEventSource.last?.url).toBe('/api/encounters/enc-1/stream');
  });

  it('status flips to "open" when EventSource.onopen fires', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    expect(get(conn.status)).toBe('connecting');
    FakeEventSource.last?.onopen?.call(
      FakeEventSource.last as unknown as EventSource,
      new Event('open')
    );
    expect(get(conn.status)).toBe('open');
  });

  // Locks the applyEvent dispatch for every event type. A regression in
  // the switch (missing case, wrong field name) silently drops live
  // updates for one of the four flows.
  it('applies a `turn` SSE event into round + activeParticipantId', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    FakeEventSource.last!.emit({ type: 'turn', round: 3, activeParticipantId: 'mob-7' });
    const snap = get(conn.state);
    expect(snap.round).toBe(3);
    expect(snap.activeParticipantId).toBe('mob-7');
  });

  it('applies a `plan` SSE event into plans[id]; null clears it', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };
    FakeEventSource.last!.emit({ type: 'plan', participantId: 'mob-7', plan });
    expect(get(conn.state).plans['mob-7']).toEqual(plan);

    FakeEventSource.last!.emit({ type: 'plan', participantId: 'mob-7', plan: null });
    expect(get(conn.state).plans['mob-7']).toBeUndefined();
  });

  it('applies an `hp` SSE event into participantHp', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    FakeEventSource.last!.emit({
      type: 'hp',
      participantId: 'mob-7',
      currentHp: 5,
      tempHp: 2,
      maxHp: 10
    });
    const hp = get(conn.state).participantHp['mob-7'];
    expect(hp.currentHp).toBe(5);
    expect(hp.tempHp).toBe(2);
  });

  it('ignores malformed SSE messages (does not throw)', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    expect(() => FakeEventSource.last!.emit('not json')).not.toThrow();
    // State should be untouched.
    expect(get(conn.state).round).toBe(0);
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
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'nope' }, 500)
    ) as typeof fetch;
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
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'nope' }, 500)
    ) as typeof fetch;
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

  it('destroy() closes the EventSource', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    const es = FakeEventSource.last!;
    conn.destroy();
    expect(es.close).toHaveBeenCalled();
  });
});
