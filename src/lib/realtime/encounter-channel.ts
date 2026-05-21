// Browser-side live channel for one encounter — short-poll implementation.
//
// State is server-authoritative (everything lives in SQL columns),
// mutations go through REST handlers, and live state is fetched every 2
// seconds from GET /api/encounters/<id>/state.
//
// Optimism: each mutator updates the local snapshot synchronously before
// the POST resolves, so the UI feels instant. If the POST fails (non-2xx),
// the next poll — or the next page reload — corrects the local state
// to whatever the server says.
//
// The shape mirrors what the SSE-based encounter-doc.ts used to expose
// (EncounterSnapshot, TurnPlan, ParticipantHp, ConnectedEncounter) so
// consumers need no changes.

import { writable, type Readable } from 'svelte/store';
import { applyDamageDelta, applyHealDelta } from '../rules/hp';
import { toasts, type ApiError } from '$lib/client/errors';

export interface TurnPlan {
  actionId: string;
  actionLabel: string;
  bonusActionId?: string;
  bonusActionLabel?: string;
  /** Single-target actions write a 1-element array; AoE actions write the
   *  full list; "self" / "no target" actions write an empty array. */
  targetParticipantIds: string[];
  bonusTargetParticipantIds?: string[];
  notes: string;
  updatedAt: number;
}

export interface ParticipantHp {
  currentHp: number | null;
  tempHp: number;
  conditions: string[];
  /** Mirror of the character document's concentration state for PCs; the
   *  encounter page surfaces this inline. May be a label object, a bare
   *  bool (legacy), or null. */
  concentrating?: { label: string; sinceRound?: number } | boolean | null;
}

export interface EncounterSnapshot {
  round: number;
  activeParticipantId: string | null;
  plans: Record<string, TurnPlan>;
  participantHp: Record<string, ParticipantHp>;
}

export interface ConnectedEncounter {
  state: Readable<EncounterSnapshot>;
  status: Readable<'connecting' | 'open' | 'closed'>;
  /** Set or update this participant's broadcast plan. Optimistic; rolls
   *  back local state if the server rejects. */
  setPlan(participantId: string, plan: TurnPlan): Promise<void>;
  clearPlan(participantId: string): Promise<void>;
  /** Replace HP fields on a non-PC participant. Use undefined to keep a
   *  field unchanged. PCs are rejected server-side (their HP lives on
   *  the character document). */
  setHp(participantId: string, hp: { currentHp?: number | null; tempHp?: number; maxHp?: number | null }): Promise<void>;
  setConditions(participantId: string, conditions: string[]): Promise<void>;
  /** Damage helper: subtract amount from current HP, draining temp HP first.
   *  Returns the new HP shape (for log-entry bookkeeping). Re-uses the SSR
   *  seed when no live entry exists yet. Fires `setHp` under the hood. */
  applyDamage(participantId: string, amount: number, seed: ParticipantHp): ParticipantHp;
  /** Heal helper: add to current HP, capped at maxHp when provided. */
  applyHeal(participantId: string, amount: number, maxHp: number | null, seed: ParticipantHp): ParticipantHp;
  /** Set or clear a non-PC participant's concentration target. Server
   *  persists to participants.concentrating_json and broadcasts. PCs are
   *  rejected — their concentration lives on the character document and
   *  flows through PATCH /api/characters. */
  setConcentration(
    participantId: string,
    concentrating: { label: string; sinceRound?: number } | null
  ): Promise<void>;
  /** Update encounter-level round / active participant. DM-only at the
   *  server; UI gates the call. */
  setTurn(next: { round?: number; activeParticipantId?: string | null }): Promise<void>;
  destroy(): void;
}

export interface EncounterConnectOptions {
  encounterId: string;
  /** Initial seed for the snapshot (typically the SSR-derived state — round,
   *  active, plans, HP). Avoids the first-paint flash before the first poll
   *  response arrives. */
  seed?: Partial<EncounterSnapshot>;
}

const POLL_INTERVAL_MS = 2000;
const MAX_ERRORS_BEFORE_ERROR_STATUS = 3;

const EMPTY: EncounterSnapshot = {
  round: 0,
  activeParticipantId: null,
  plans: {},
  participantHp: {}
};

export function connectEncounter(opts: EncounterConnectOptions): ConnectedEncounter {
  const initial: EncounterSnapshot = {
    round: opts.seed?.round ?? EMPTY.round,
    activeParticipantId: opts.seed?.activeParticipantId ?? EMPTY.activeParticipantId,
    plans: opts.seed?.plans ?? {},
    participantHp: opts.seed?.participantHp ?? {}
  };

  const state = writable<EncounterSnapshot>(initial);
  const status = writable<'connecting' | 'open' | 'closed'>('connecting');

  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let consecutiveErrors = 0;

  async function poll() {
    if (destroyed) return;
    try {
      const res = await fetch(`/api/encounters/${opts.encounterId}/state`);
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_ERROR_STATUS) {
          status.set('connecting');
        }
        return;
      }
      const data = (await res.json()) as EncounterSnapshot;
      consecutiveErrors = 0;
      state.set({
        round: data.round,
        activeParticipantId: data.activeParticipantId,
        plans: (data.plans ?? {}) as Record<string, TurnPlan>,
        participantHp: (data.participantHp ?? {}) as Record<string, ParticipantHp>
      });
      status.set('open');
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_ERRORS_BEFORE_ERROR_STATUS) {
        status.set('connecting');
      }
    }
  }

  if (typeof window !== 'undefined') {
    // Fire first poll immediately, then on interval
    void poll();
    timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  }

  async function send(path: string, init?: RequestInit) {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
    });
    if (!res.ok) {
      let err: ApiError = { message: `Request failed (${res.status})` };
      try {
        const body = await res.json();
        if (typeof body.message === 'string') err = body as ApiError;
      } catch { /* use status-based message */ }
      toasts.add({ type: 'error', message: err.message, requestId: err.requestId });
      throw err;
    }
  }

  return {
    state: { subscribe: state.subscribe },
    status: { subscribe: status.subscribe },

    async setPlan(participantId, plan) {
      const prev = readPlan(state, participantId);
      state.update((s) => ({ ...s, plans: { ...s.plans, [participantId]: plan } }));
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/plan`,
          { method: 'POST', body: JSON.stringify({ plan }) }
        );
      } catch (err) {
        state.update((s) => {
          const plans = { ...s.plans };
          if (prev) plans[participantId] = prev;
          else delete plans[participantId];
          return { ...s, plans };
        });
        throw err;
      }
    },

    async clearPlan(participantId) {
      const prev = readPlan(state, participantId);
      state.update((s) => {
        const plans = { ...s.plans };
        delete plans[participantId];
        return { ...s, plans };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/plan`,
          { method: 'DELETE' }
        );
      } catch (err) {
        if (prev) {
          state.update((s) => ({ ...s, plans: { ...s.plans, [participantId]: prev } }));
        }
        throw err;
      }
    },

    async setHp(participantId, hp) {
      const prev = readHp(state, participantId);
      state.update((s) => {
        const participantHp = {
          ...s.participantHp,
          [participantId]: {
            currentHp: hp.currentHp !== undefined ? hp.currentHp : prev?.currentHp ?? null,
            tempHp: hp.tempHp !== undefined ? hp.tempHp : prev?.tempHp ?? 0,
            conditions: prev?.conditions ?? [],
            concentrating: prev?.concentrating ?? null
          }
        };
        return { ...s, participantHp };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/hp`,
          { method: 'POST', body: JSON.stringify(hp) }
        );
      } catch (err) {
        state.update((s) => {
          const participantHp = { ...s.participantHp };
          if (prev) participantHp[participantId] = prev;
          else delete participantHp[participantId];
          return { ...s, participantHp };
        });
        throw err;
      }
    },

    async setConditions(participantId, conditions) {
      const prev = readHp(state, participantId);
      state.update((s) => {
        const participantHp = {
          ...s.participantHp,
          [participantId]: {
            currentHp: prev?.currentHp ?? null,
            tempHp: prev?.tempHp ?? 0,
            conditions,
            concentrating: prev?.concentrating ?? null
          }
        };
        return { ...s, participantHp };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/conditions`,
          { method: 'POST', body: JSON.stringify({ conditions }) }
        );
      } catch (err) {
        state.update((s) => {
          const participantHp = { ...s.participantHp };
          if (prev) participantHp[participantId] = prev;
          else delete participantHp[participantId];
          return { ...s, participantHp };
        });
        throw err;
      }
    },

    applyDamage(participantId, amount, seed) {
      const cur = readHp(state, participantId) ?? seed;
      const next = applyDamageDelta(cur, amount);
      // fire-and-forget; rollback handled inside setHp on failure
      void this.setHp(participantId, { currentHp: next.currentHp, tempHp: next.tempHp });
      return next;
    },

    async setConcentration(participantId, concentrating) {
      const prev = readHp(state, participantId);
      state.update((s) => {
        const cur = s.participantHp[participantId];
        return {
          ...s,
          participantHp: {
            ...s.participantHp,
            [participantId]: {
              currentHp: cur?.currentHp ?? null,
              tempHp: cur?.tempHp ?? 0,
              conditions: cur?.conditions ?? [],
              concentrating
            }
          }
        };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/concentration`,
          { method: 'POST', body: JSON.stringify({ concentrating }) }
        );
      } catch (err) {
        state.update((s) => {
          const participantHp = { ...s.participantHp };
          if (prev) participantHp[participantId] = prev;
          else delete participantHp[participantId];
          return { ...s, participantHp };
        });
        throw err;
      }
    },

    applyHeal(participantId, amount, maxHp, seed) {
      const cur = readHp(state, participantId) ?? seed;
      const next = applyHealDelta(cur, amount, maxHp);
      void this.setHp(participantId, { currentHp: next.currentHp });
      return next;
    },

    async setTurn(next) {
      const snap = readSnap(state);
      state.update((s) => ({
        ...s,
        round: next.round !== undefined ? next.round : s.round,
        activeParticipantId:
          next.activeParticipantId !== undefined ? next.activeParticipantId : s.activeParticipantId
      }));
      try {
        await send(`/api/encounters/${opts.encounterId}`, {
          method: 'PATCH',
          body: JSON.stringify(next)
        });
      } catch (err) {
        state.update((s) => ({ ...s, round: snap.round, activeParticipantId: snap.activeParticipantId }));
        throw err;
      }
    },

    destroy() {
      destroyed = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      status.set('closed');
    }
  };
}

// --- store accessors (Svelte stores are write-only from here; we use these
// tiny readers to capture the current value for optimistic rollback) ---

function readSnap(s: ReturnType<typeof writable<EncounterSnapshot>>): EncounterSnapshot {
  let out = EMPTY;
  s.update((cur) => {
    out = cur;
    return cur;
  });
  return out;
}
function readPlan(
  s: ReturnType<typeof writable<EncounterSnapshot>>,
  pid: string
): TurnPlan | undefined {
  return readSnap(s).plans[pid];
}
function readHp(
  s: ReturnType<typeof writable<EncounterSnapshot>>,
  pid: string
): ParticipantHp | undefined {
  return readSnap(s).participantHp[pid];
}
