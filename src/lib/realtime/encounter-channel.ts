// Browser-side live channel for one encounter.
//
// Replaces the old Y.Doc-based encounter-doc.ts: state is server-authoritative
// (everything lives in SQL columns), mutations go through plain REST POSTs,
// and live updates arrive over SSE at /api/encounters/<id>/stream.
//
// Optimism: each mutator updates the local snapshot synchronously before
// the POST resolves, so the UI feels instant. If the POST fails (non-2xx),
// the next SSE message — or the next page reload — corrects the local state
// to whatever the server says.
//
// The shape mirrors what encounter-doc.ts used to expose (EncounterSnapshot,
// TurnPlan, ParticipantHp, ConnectedEncounter) so consumers update import
// paths but not the data they read.

import { writable, type Readable } from 'svelte/store';

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
  /** Update a non-PC participant's concentration label in the local snapshot.
   *  Not persisted server-side yet — TODO: add concentrating_json column +
   *  endpoint so cross-tab sync works for monster concentration too. PCs
   *  flow through PATCH /api/characters since concentration lives on the
   *  character document. */
  setLocalConcentration(participantId: string, concentrating: ParticipantHp['concentrating']): void;
  /** Update encounter-level round / active participant. DM-only at the
   *  server; UI gates the call. */
  setTurn(next: { round?: number; activeParticipantId?: string | null }): Promise<void>;
  destroy(): void;
}

export interface EncounterConnectOptions {
  encounterId: string;
  /** Initial seed for the snapshot (typically the SSR-derived state — round,
   *  active, plans, HP). Avoids the first-paint flash before SSE arrives. */
  seed?: Partial<EncounterSnapshot>;
}

type ServerEvent =
  | { type: 'turn'; round: number; activeParticipantId: string | null }
  | { type: 'plan'; participantId: string; plan: TurnPlan | null }
  | { type: 'hp'; participantId: string; currentHp: number | null; tempHp: number; maxHp: number | null }
  | { type: 'conditions'; participantId: string; conditions: string[] };

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

  let es: EventSource | null = null;
  let destroyed = false;

  function applyEvent(ev: ServerEvent) {
    state.update((s) => {
      switch (ev.type) {
        case 'turn':
          return { ...s, round: ev.round, activeParticipantId: ev.activeParticipantId };
        case 'plan': {
          const plans = { ...s.plans };
          if (ev.plan) plans[ev.participantId] = ev.plan;
          else delete plans[ev.participantId];
          return { ...s, plans };
        }
        case 'hp': {
          const prev = s.participantHp[ev.participantId];
          const participantHp = {
            ...s.participantHp,
            [ev.participantId]: {
              currentHp: ev.currentHp,
              tempHp: ev.tempHp,
              conditions: prev?.conditions ?? [],
              concentrating: prev?.concentrating ?? null
            }
          };
          return { ...s, participantHp };
        }
        case 'conditions': {
          const prev = s.participantHp[ev.participantId];
          const participantHp = {
            ...s.participantHp,
            [ev.participantId]: {
              currentHp: prev?.currentHp ?? null,
              tempHp: prev?.tempHp ?? 0,
              conditions: ev.conditions,
              concentrating: prev?.concentrating ?? null
            }
          };
          return { ...s, participantHp };
        }
        default:
          return s;
      }
    });
  }

  function open() {
    if (destroyed || typeof window === 'undefined') return;
    es = new EventSource(`/api/encounters/${opts.encounterId}/stream`);
    es.onopen = () => status.set('open');
    es.onerror = () => {
      // EventSource auto-reconnects on its own; reflect transient state.
      status.set('connecting');
    };
    es.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as ServerEvent;
        applyEvent(payload);
      } catch {
        // ignore malformed event
      }
    };
  }

  open();

  async function send(path: string, init?: RequestInit) {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${res.status} ${text.slice(0, 200)}`);
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
      const n = Math.max(0, Math.floor(amount));
      const cur = readHp(state, participantId) ?? seed;
      const tempAbsorbed = Math.min(cur.tempHp ?? 0, n);
      const next: ParticipantHp = {
        ...cur,
        currentHp:
          cur.currentHp == null ? null : Math.max(0, cur.currentHp - (n - tempAbsorbed)),
        tempHp: (cur.tempHp ?? 0) - tempAbsorbed
      };
      // fire-and-forget; rollback handled inside setHp on failure
      void this.setHp(participantId, { currentHp: next.currentHp, tempHp: next.tempHp });
      return next;
    },

    setLocalConcentration(participantId, concentrating) {
      state.update((s) => {
        const prev = s.participantHp[participantId];
        return {
          ...s,
          participantHp: {
            ...s.participantHp,
            [participantId]: {
              currentHp: prev?.currentHp ?? null,
              tempHp: prev?.tempHp ?? 0,
              conditions: prev?.conditions ?? [],
              concentrating
            }
          }
        };
      });
    },

    applyHeal(participantId, amount, maxHp, seed) {
      const n = Math.max(0, Math.floor(amount));
      const cur = readHp(state, participantId) ?? seed;
      const next: ParticipantHp = {
        ...cur,
        currentHp:
          cur.currentHp == null
            ? null
            : maxHp != null
              ? Math.min(maxHp, cur.currentHp + n)
              : cur.currentHp + n
      };
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
      es?.close();
      es = null;
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
