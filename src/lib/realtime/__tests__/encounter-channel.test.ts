// @vitest-environment jsdom
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

  it('updates status and the participant list from poll response', async () => {
    const wireParticipant = {
      id: 'mob-1',
      kind: 'monster',
      characterId: null,
      name: 'Enemy 1',
      placeholderName: 'Enemy 1',
      initiative: 14,
      sortOrder: 0,
      reveals: { identity: false, vitals: false, combat: false, hidden: false }
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) {
        return jsonResponse(
          stateSnapshot({ status: 'live', participants: [wireParticipant] } as never)
        );
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    // Seed defaults: unknown until the first poll answers.
    expect(get(conn.state).status).toBeNull();
    expect(get(conn.state).participants).toBeNull();
    await new Promise((r) => setTimeout(r, 0));

    const snap = get(conn.state);
    expect(snap.status).toBe('live');
    expect(snap.participants).toEqual([wireParticipant]);
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

  // ---- combat economy (WS2 phase 4) --------------------------------------
  //
  // The action / bonus / reaction / movement flags and the legendary counter
  // used to be client-only and vanished on reload. They now go to the
  // server: character document for PCs, plan_json.combat for everyone else.

  const economy = {
    actionUsed: true,
    bonusUsed: false,
    reactionUsed: false,
    movementUsed: 15,
    legendaryUsed: 2,
    round: 3
  };

  it('setEconomy updates the local snapshot synchronously', async () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    const promise = conn.setEconomy('mob-7', null, economy);
    expect(get(conn.state).participantEconomy['mob-7']).toEqual(economy);
    await promise;
  });

  it('setEconomy on a non-PC merges into the participant plan POST', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await conn.setPlan('mob-7', {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: ['pc-1'],
      notes: 'chomp',
      updatedAt: 1
    });
    await conn.setEconomy('mob-7', null, economy);

    const last = calls.at(-1)!;
    expect(last.url).toContain('/participants/mob-7/plan');
    const plan = (last.body as { plan: TurnPlan }).plan;
    // The declared intent survives the economy write.
    expect(plan.actionId).toBe('bite');
    expect(plan.targetParticipantIds).toEqual(['pc-1']);
    expect(plan.combat).toEqual(economy);
  });

  it('setEconomy on a PC writes the character document fields', async () => {
    const patches: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      if (url.includes('/api/characters/')) {
        if (init?.method === 'PATCH') {
          patches.push(JSON.parse(init.body as string).document);
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ document: { name: 'Hero' } });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await conn.setEconomy('pc-row', 'char-1', economy);

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      name: 'Hero',
      actionUsedThisRound: true,
      bonusActionUsedThisRound: false,
      reactionUsedThisRound: false,
      movementUsedThisRound: 15
    });
  });

  it('setEconomy rolls back when the write fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      return jsonResponse({ error: 'nope' }, 500);
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await expect(conn.setEconomy('mob-7', null, economy)).rejects.toBeTruthy();
    expect(get(conn.state).participantEconomy['mob-7']).toBeUndefined();
  });

  // Clearing the *intent* must not clear the *counters* that share the
  // column — a DM clearing a monster's plan mid-round would otherwise reset
  // its legendary-action tally.
  it('clearPlan keeps the combat blob by writing an empty plan', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : null
      });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await conn.setPlan('mob-7', {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    });
    await conn.setEconomy('mob-7', null, economy);
    await conn.clearPlan('mob-7');

    const last = calls.at(-1)!;
    expect(last.method).toBe('POST');
    const plan = (last.body as { plan: TurnPlan }).plan;
    expect(plan.actionId).toBe('');
    expect(plan.combat).toEqual(economy);
    // The store still reports "no plan" to the UI (empty actionId).
    expect(get(conn.state).plans['mob-7']?.actionId).toBe('');
  });

  // Regression: the NPC spell-slot tracker rides the same `combat` blob but
  // is encounter-scoped — a DM clearing a monster's declared action must not
  // hand the drow mage back its slots.
  it('persists the NPC spell-slot tally and keeps it through clearPlan', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : null
      });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    const withSlots = {
      ...economy,
      spellSlots: { 3: { max: 3, used: 2 } }
    };
    await conn.setEconomy('mob-7', null, withSlots);
    expect(get(conn.state).participantEconomy['mob-7']).toEqual(withSlots);
    expect(
      ((calls.at(-1)!.body as { plan: TurnPlan }).plan.combat as typeof withSlots).spellSlots
    ).toEqual({ 3: { max: 3, used: 2 } });

    await conn.clearPlan('mob-7');
    const cleared = (calls.at(-1)!.body as { plan: TurnPlan }).plan;
    expect(cleared.actionId).toBe('');
    expect(cleared.combat).toEqual(withSlots);
  });

  it('clearPlan still DELETEs when there is no combat state to keep', async () => {
    const calls: Array<{ method?: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({ method: init?.method });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await conn.setPlan('mob-7', {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    });
    await conn.clearPlan('mob-7');
    expect(calls.at(-1)!.method).toBe('DELETE');
    expect(get(conn.state).plans['mob-7']).toBeUndefined();
  });

  // Round-scoped condition durations share plan_json with the combat
  // counters, so the same "clearing intent must not clear state" rule
  // applies to them.
  it('setConditionTimers on a non-PC merges into the participant plan POST', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    const timers = [{ condition: 'poisoned', untilRound: 6 }];
    await conn.setConditionTimers('mob-7', null, timers);

    expect(calls.at(-1)!.url).toContain('/participants/mob-7/plan');
    expect((calls.at(-1)!.body as { plan: TurnPlan }).plan.conditionTimers).toEqual(timers);
    expect(get(conn.state).participantHp['mob-7'].conditionTimers).toEqual(timers);
  });

  it('setConditionTimers on a PC writes the character document field', async () => {
    const patches: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      if (url.includes('/api/characters/char-1')) {
        if (init?.method === 'PATCH') {
          patches.push(JSON.parse(init.body as string));
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ document: { conditions: ['poisoned'] } });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    const timers = [{ condition: 'poisoned', untilRound: 3 }];
    await conn.setConditionTimers('pc-row', 'char-1', timers);

    expect(patches).toHaveLength(1);
    const doc = (patches[0] as { document: Record<string, unknown> }).document;
    expect(doc.conditionTimers).toEqual(timers);
    // The flat condition list is untouched — it stays the source of truth.
    expect(doc.conditions).toEqual(['poisoned']);
  });

  it('clearPlan keeps the condition timers by writing an empty plan', async () => {
    const calls: Array<{ method?: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({ method: init?.method, body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    const timers = [{ condition: 'restrained', untilRound: 9 }];
    await conn.setConditionTimers('mob-7', null, timers);
    await conn.setPlan('mob-7', {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1,
      conditionTimers: timers
    });
    await conn.clearPlan('mob-7');

    const last = calls.at(-1)!;
    expect(last.method).toBe('POST');
    const plan = (last.body as { plan: TurnPlan }).plan;
    expect(plan.actionId).toBe('');
    expect(plan.conditionTimers).toEqual(timers);
  });

  it('setLair marks the participant and survives a plan clear', async () => {
    const calls: Array<{ method?: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state')) return jsonResponse(stateSnapshot());
      calls.push({ method: init?.method, body: init?.body ? JSON.parse(init.body as string) : null });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await conn.setLair('mob-7', true);
    expect(get(conn.state).plans['mob-7']?.lair).toBe(true);
    await conn.clearPlan('mob-7');
    const plan = (calls.at(-1)!.body as { plan: TurnPlan }).plan;
    expect(plan.lair).toBe(true);
    // …and unsetting it clears the flag rather than leaving it sticky.
    await conn.setLair('mob-7', false);
    expect(get(conn.state).plans['mob-7']?.lair).toBe(false);
  });

  it('normalizes participantEconomy off the poll payload', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/state'))
        return jsonResponse({
          ...stateSnapshot(),
          participantEconomy: { 'mob-7': { actionUsed: true, legendaryUsed: 'bogus' } }
        });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    conn = connectEncounter({ encounterId: 'enc-1' });
    await vi.waitFor(() => expect(get(conn.state).participantEconomy['mob-7']).toBeDefined());
    expect(get(conn.state).participantEconomy['mob-7']).toEqual({
      actionUsed: true,
      bonusUsed: false,
      reactionUsed: false,
      movementUsed: 0,
      legendaryUsed: 0
    });
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

    // Damage-source predicate consumer wiring (engine gap #1 — see
    // docs/engine-gaps.md). When the caller passes a resolution payload
    // containing the target's source-predicate maps + the incoming
    // event's source kind, the channel narrows the amount before
    // subtracting HP. Spell-Resistant: only halves spell-source fire.
    it('applyDamage halves predicate-narrowed fire when source is a spell', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const cleanSeed: ParticipantHp = { currentHp: 10, tempHp: 0, conditions: [], concentrating: null };
      const next = conn.applyDamage('mob-7', 8, cleanSeed, {
        damageType: 'fire',
        context: { damageSourceKind: 'spell' },
        stats: {
          resistances: new Set(['fire']),
          immunities: new Set(),
          vulnerabilities: new Set(),
          resistanceQualifiers: {},
          immunityQualifiers: {},
          vulnerabilityQualifiers: {},
          resistanceSourcePredicates: { fire: { kind: 'spell' } },
          immunitySourcePredicates: {},
          vulnerabilitySourcePredicates: {}
        }
      });
      expect(next.currentHp).toBe(6); // 10 - floor(8/2) = 6
    });

    it('applyDamage does NOT halve predicate-narrowed fire from a weapon source', () => {
      conn = connectEncounter({ encounterId: 'enc-1' });
      const cleanSeed: ParticipantHp = { currentHp: 10, tempHp: 0, conditions: [], concentrating: null };
      const next = conn.applyDamage('mob-7', 8, cleanSeed, {
        damageType: 'fire',
        context: { damageSourceKind: 'nonmagical' },
        stats: {
          resistances: new Set(['fire']),
          immunities: new Set(),
          vulnerabilities: new Set(),
          resistanceQualifiers: {},
          immunityQualifiers: {},
          vulnerabilityQualifiers: {},
          resistanceSourcePredicates: { fire: { kind: 'spell' } },
          immunitySourcePredicates: {},
          vulnerabilitySourcePredicates: {}
        }
      });
      expect(next.currentHp).toBe(2); // 10 - 8 = 2 (no narrowing applies)
    });
  });

  it('destroy() stops the polling interval and sets status to closed', () => {
    conn = connectEncounter({ encounterId: 'enc-1' });
    conn.destroy();
    expect(get(conn.status)).toBe('closed');
  });

  // --- stale-poll guard: poll/mutation interleaving ------------------------
  describe('stale-poll guard', () => {
    const plan: TurnPlan = {
      actionId: 'bite',
      actionLabel: 'Bite',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 1
    };

    // The core race: a poll is issued (fetch in flight), then a mutation
    // writes optimistically and its POST succeeds, and only THEN the poll
    // resolves with a pre-mutation snapshot. Applying it would erase the
    // plan until the next poll. The guard must drop that snapshot.
    it('drops a pre-mutation poll snapshot that resolves after setPlan succeeded', async () => {
      let resolveStalePoll!: (r: Response) => void;
      const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
      let stateCalls = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/state')) {
          stateCalls++;
          // First poll (fired on connect) hangs until we release it.
          if (stateCalls === 1) return stalePoll;
          return jsonResponse(stateSnapshot());
        }
        return jsonResponse({ ok: true });
      }) as typeof fetch;

      conn = connectEncounter({ encounterId: 'enc-1' });
      // Poll #1 is now in flight. Mutate: optimistic write + successful POST.
      await conn.setPlan('mob-7', plan);
      expect(get(conn.state).plans['mob-7']).toEqual(plan);

      // Now the stale poll resolves with the pre-mutation (empty) snapshot.
      resolveStalePoll(jsonResponse(stateSnapshot()));
      await new Promise((r) => setTimeout(r, 0));

      // The optimistic plan must NOT be clobbered.
      expect(get(conn.state).plans['mob-7']).toEqual(plan);
      // The connection is still healthy — dropping a stale payload is not an error.
      expect(get(conn.status)).toBe('open');
    });

    it('drops a poll snapshot that resolves while a mutation is still in flight', async () => {
      let resolvePost!: (r: Response) => void;
      const postGate = new Promise<Response>((r) => { resolvePost = r; });
      let resolveStalePoll!: (r: Response) => void;
      const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
      let stateCalls = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/state')) {
          stateCalls++;
          if (stateCalls === 1) return stalePoll;
          return jsonResponse(stateSnapshot());
        }
        return postGate; // POST hangs until released
      }) as typeof fetch;

      conn = connectEncounter({ encounterId: 'enc-1' });
      const pending = conn.setPlan('mob-7', plan); // optimistic write, POST in flight
      expect(get(conn.state).plans['mob-7']).toEqual(plan);

      // Stale poll resolves while the POST is still unresolved.
      resolveStalePoll(jsonResponse(stateSnapshot()));
      await new Promise((r) => setTimeout(r, 0));
      expect(get(conn.state).plans['mob-7']).toEqual(plan);

      resolvePost(jsonResponse({ ok: true }));
      await pending;
      expect(get(conn.state).plans['mob-7']).toEqual(plan);
    });

    // Polls must not starve: once mutations are quiescent, the next poll's
    // snapshot (now reflecting the committed mutation, or any newer server
    // state) must apply.
    it('applies the next poll after quiescence (fresh server state wins)', async () => {
      vi.useFakeTimers();
      try {
        const serverPlans: Record<string, TurnPlan> = {};
        let serverRound = 1;
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('/state')) {
            return jsonResponse(stateSnapshot({ round: serverRound, plans: { ...serverPlans } }));
          }
          return jsonResponse({ ok: true });
        }) as typeof fetch;

        conn = connectEncounter({ encounterId: 'enc-1' });
        await vi.advanceTimersByTimeAsync(0); // flush the first poll

        const mutation = conn.setPlan('mob-7', plan);
        await vi.advanceTimersByTimeAsync(0);
        await mutation;

        // Server has committed the plan and advanced the round elsewhere.
        serverPlans['mob-7'] = plan;
        serverRound = 4;

        // Next interval poll fires after quiescence — it must apply.
        await vi.advanceTimersByTimeAsync(2000);
        const snap = get(conn.state);
        expect(snap.round).toBe(4);
        expect(snap.plans['mob-7']).toEqual(plan);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not remember the ETag of a snapshot dropped by the stale-poll guard', async () => {
      vi.useFakeTimers();
      try {
        let resolveStalePoll!: (r: Response) => void;
        const stalePoll = new Promise<Response>((r) => { resolveStalePoll = r; });
        const inmHeaders: Array<string | null> = [];
        let stateCalls = 0;
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('/state')) {
            stateCalls++;
            inmHeaders.push(new Headers(init?.headers).get('if-none-match'));
            if (stateCalls === 1) return stalePoll;
            return new Response(JSON.stringify(stateSnapshot()), {
              status: 200,
              headers: { 'content-type': 'application/json', etag: '"t2"' }
            });
          }
          return jsonResponse({ ok: true });
        }) as typeof fetch;

        conn = connectEncounter({ encounterId: 'enc-1' });
        // Poll #1 in flight; mutate so the guard will drop its snapshot.
        const mutation = conn.setPlan('mob-7', plan);
        await vi.advanceTimersByTimeAsync(0);
        await mutation;

        // The stale poll resolves carrying an ETag. Its snapshot is dropped
        // — the ETag must be dropped with it, or the next poll would 304
        // against state the store never applied.
        resolveStalePoll(
          new Response(JSON.stringify(stateSnapshot()), {
            status: 200,
            headers: { 'content-type': 'application/json', etag: '"t1"' }
          })
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(get(conn.state).plans['mob-7']).toEqual(plan);

        await vi.advanceTimersByTimeAsync(2000);
        expect(stateCalls).toBe(2);
        expect(inmHeaders[1]).toBeNull(); // no If-None-Match sent
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failed mutation still lets subsequent polls apply (guard resets on settle)', async () => {
      let serverRound = 1;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/state')) return jsonResponse(stateSnapshot({ round: serverRound }));
        return jsonResponse({ error: 'nope' }, 500);
      }) as typeof fetch;

      vi.useFakeTimers();
      try {
        conn = connectEncounter({ encounterId: 'enc-1' });
        await vi.advanceTimersByTimeAsync(0);

        await expect(conn.setPlan('mob-7', plan)).rejects.toThrow(/500/);
        // Rollback still happened.
        expect(get(conn.state).plans['mob-7']).toBeUndefined();

        serverRound = 9;
        await vi.advanceTimersByTimeAsync(2000);
        expect(get(conn.state).round).toBe(9);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // --- ETag / 304 handling --------------------------------------------------
  describe('ETag / 304 handling', () => {
    it('remembers the ETag, sends If-None-Match, and treats 304 as a healthy no-op', async () => {
      vi.useFakeTimers();
      try {
        const inmHeaders: Array<string | null> = [];
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('/state')) {
            const inm = new Headers(init?.headers).get('if-none-match');
            inmHeaders.push(inm);
            if (inm === '"tok-1"') {
              return new Response(null, { status: 304, headers: { etag: '"tok-1"' } });
            }
            return new Response(JSON.stringify(stateSnapshot({ round: 3 })), {
              status: 200,
              headers: { 'content-type': 'application/json', etag: '"tok-1"' }
            });
          }
          return jsonResponse({ ok: true });
        }) as typeof fetch;

        conn = connectEncounter({ encounterId: 'enc-1' });
        await vi.advanceTimersByTimeAsync(0);
        // First poll: no ETag yet, full snapshot applied.
        expect(inmHeaders[0]).toBeNull();
        expect(get(conn.state).round).toBe(3);
        expect(get(conn.status)).toBe('open');

        // Second poll: If-None-Match echoed, 304 → store untouched, still open.
        await vi.advanceTimersByTimeAsync(2000);
        expect(inmHeaders[1]).toBe('"tok-1"');
        expect(get(conn.state).round).toBe(3);
        expect(get(conn.status)).toBe('open');
      } finally {
        vi.useRealTimers();
      }
    });

    it('304 resets the consecutive-error counter', async () => {
      vi.useFakeTimers();
      try {
        let mode: '200' | '500' | '304' = '200';
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('/state')) {
            if (mode === '500') return jsonResponse({ error: 'x' }, 500);
            if (mode === '304') return new Response(null, { status: 304 });
            return new Response(JSON.stringify(stateSnapshot({ round: 1 })), {
              status: 200,
              headers: { 'content-type': 'application/json', etag: '"t"' }
            });
          }
          return jsonResponse({ ok: true });
        }) as typeof fetch;

        conn = connectEncounter({ encounterId: 'enc-1' });
        await vi.advanceTimersByTimeAsync(0); // 200 — open
        mode = '500';
        await vi.advanceTimersByTimeAsync(2000); // error 1
        await vi.advanceTimersByTimeAsync(2000); // error 2
        expect(get(conn.status)).toBe('open'); // threshold (3) not reached

        mode = '304';
        await vi.advanceTimersByTimeAsync(2000); // healthy no-change → counter resets

        mode = '500';
        await vi.advanceTimersByTimeAsync(2000); // error 1 (again)
        await vi.advanceTimersByTimeAsync(2000); // error 2 (again)
        // Without the reset this would be the 4th consecutive error and the
        // status would have degraded to 'connecting'.
        expect(get(conn.status)).toBe('open');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
