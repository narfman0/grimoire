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
import type { LiveParticipant } from './participants';
import {
  economyToCharacterDocFields,
  normalizeEconomy,
  type CombatEconomy
} from './economy';
import { patchCharacterDocFields } from '$lib/encounter/conditions';
import type { ConditionTimer } from '$lib/encounter/condition-timers';
import { applyDamageDelta, applyHealDelta } from '../rules/hp';
import { computeIncomingDamage, type DamageResolutionStats } from '../rules/incoming-damage';
import type { DamageSourceContext } from '../rules/damage-source';
import { toasts, type ApiError } from '$lib/client/errors';

/** Optional resolution context for an incoming damage event. When passed
 *  to `applyDamage`, the channel runs the amount through
 *  `computeIncomingDamage(...)` to apply the target's predicate-narrowed
 *  resistance/immunity/vulnerability before subtracting HP. When omitted,
 *  the channel falls back to the legacy unconditional `applyDamageDelta`
 *  shape so call sites that don't yet plumb the damage type are
 *  unaffected. */
export interface IncomingDamageResolution {
  damageType?: string;
  context?: DamageSourceContext;
  stats?: DamageResolutionStats;
}

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
  /** Planned board destination; applied to posX/posY when the turn
   *  advances past this participant. */
  moveTo?: { x: number; y: number };
  /** Cheapest path to moveTo, for opportunity-attack-aware display. */
  path?: Array<{ x: number; y: number }>;
  /** Non-PC combat economy (used-slot flags, legendary counter, the DM's
   *  NPC spell-slot tally). Rides plan_json because participants have no
   *  combat-state column of their own; PCs keep the same state on the
   *  character document instead. See $lib/realtime/economy. */
  combat?: Partial<CombatEconomy>;
  /** Round-scoped condition durations for a non-PC participant. Overlay on
   *  the flat conditions list; rides plan_json for the same reason `combat`
   *  does. See $lib/encounter/condition-timers. */
  conditionTimers?: ConditionTimer[];
  /** DM marker: this creature has lair actions in this encounter. */
  lair?: boolean;
}

export interface ParticipantHp {
  currentHp: number | null;
  tempHp: number;
  /** Coarse health band, server-computed. For a player looking at a non-PC
   *  row whose `vitals` flag is off this is the only HP signal they get —
   *  `currentHp` / `maxHp` come through null. Read it rather than bucketing
   *  the numbers yourself. */
  hpBucket?: string;
  conditions: string[];
  /** Duration overlay on `conditions`, server-projected from the character
   *  document (PCs) or plan_json (everyone else). */
  conditionTimers?: ConditionTimer[];
  /** Mirror of the character document's concentration state for PCs; the
   *  encounter page surfaces this inline. May be a label object, a bare
   *  bool (legacy), or null. */
  concentrating?: { label: string; sinceRound?: number } | boolean | null;
}

export interface EncounterSnapshot {
  round: number;
  /** Encounter lifecycle status. Null until the first poll response (the
   *  SSR seed provides it) — consumers fall back to page data. */
  status: 'staging' | 'live' | 'ended' | null;
  activeParticipantId: string | null;
  /** Role-redacted membership/order/name/reveals list from the poll. Null
   *  until the first poll response; consumers fall back to SSR page data.
   *  Array order is the authoritative initiative order. */
  participants: LiveParticipant[] | null;
  plans: Record<string, TurnPlan>;
  participantHp: Record<string, ParticipantHp>;
  /** Per-participant action / bonus / reaction / movement flags plus the
   *  legendary-action counter, server-projected so a second DM tab agrees
   *  and a reload doesn't forget what's been spent. */
  participantEconomy: Record<string, CombatEconomy>;
  /** DM lair markers by participant id. Projected by the poll since the
   *  marker moved off plan_json into its own column (migration 0009). */
  participantLair: Record<string, boolean>;
  /** Per-PC resource spend counters (`resourcesSpent` off the character
   *  document). The planner folds these over the SSR pool sizes so
   *  "2/5 Ki left" tracks a mid-combat spend on the character sheet
   *  instead of waiting for the next `invalidateAll`. See
   *  `withLiveResources` in $lib/encounter/action-availability. */
  participantResources: Record<string, Record<string, number>>;
  /** Board token positions for placed participants. Role-redacted server
   *  side: a player never receives a token sitting entirely in unrevealed
   *  fog. */
  positions: Record<string, ParticipantPosition>;
  /** encounter_boards.version, or null when no board is attached. The
   *  encounter page refetches GET .../board when this bumps. */
  boardVersion: number | null;
}

export interface ParticipantPosition {
  x: number;
  y: number;
  sizeCells: number;
}

export interface ConnectedEncounter {
  state: Readable<EncounterSnapshot>;
  status: Readable<'connecting' | 'open' | 'closed'>;
  /** Set or update this participant's broadcast plan. Optimistic; rolls
   *  back local state if the server rejects. */
  setPlan(participantId: string, plan: TurnPlan): Promise<void>;
  clearPlan(participantId: string): Promise<void>;
  /** Persist this participant's combat economy. PCs (pass their
   *  `characterId`) round-trip the character document's *UsedThisRound
   *  fields; everyone else merges into plan_json.combat. Optimistic and
   *  covered by the stale-poll guard, so an in-flight poll can't briefly
   *  un-mark a slot the user just marked. */
  setEconomy(
    participantId: string,
    characterId: string | null,
    next: CombatEconomy
  ): Promise<void>;
  /** Replace HP fields on a non-PC participant. Use undefined to keep a
   *  field unchanged. PCs are rejected server-side (their HP lives on
   *  the character document). */
  setHp(participantId: string, hp: { currentHp?: number | null; tempHp?: number; maxHp?: number | null }): Promise<void>;
  setConditions(participantId: string, conditions: string[]): Promise<void>;
  /** Persist the round-scoped condition-duration overlay. PCs (pass their
   *  `characterId`) write the character document's `conditionTimers` field;
   *  everyone else merges into plan_json. Optimistic, same as the flat
   *  condition write. */
  setConditionTimers(
    participantId: string,
    characterId: string | null,
    timers: ConditionTimer[]
  ): Promise<void>;
  /** Flag/unflag a non-PC participant as having lair actions in this
   *  encounter. Persists to combat_state_json — no statblock carries lair
   *  data. */
  setLair(participantId: string, lair: boolean): Promise<void>;
  /** Move a token on the board (null = take it off). DM moves anyone;
   *  players their own PC (server-enforced). Optimistic and covered by the
   *  stale-poll guard like every other mutator. */
  /** Move or unplace a token. `sizeCells` is optional and display-only: it
   *  seeds the optimistic entry's footprint so a big token doesn't draw 1×1
   *  until the next poll. The server takes the size from the participant row,
   *  never from here. */
  setPosition(
    participantId: string,
    pos: { x: number; y: number; sizeCells?: number } | null
  ): Promise<void>;
  /** Damage helper: subtract amount from current HP, draining temp HP first.
   *  Returns the new HP shape (for log-entry bookkeeping). Re-uses the SSR
   *  seed when no live entry exists yet. Fires `setHp` under the hood.
   *
   *  Optional `resolution` carries damage type + source context + the
   *  target's stat-block predicate maps. When provided, the channel
   *  consults the target's resistance/immunity/vulnerability source
   *  predicates via `computeIncomingDamage` before subtracting HP — so a
   *  Spell-Resistant character only halves fire from a spell source.
   *  When omitted (the legacy call shape), the amount is applied
   *  unconditionally. */
  applyDamage(
    participantId: string,
    amount: number,
    seed: ParticipantHp,
    resolution?: IncomingDamageResolution
  ): ParticipantHp;
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
  /** Update encounter-level round / active participant / lifecycle status.
   *  DM-only at the server; UI gates the call. Routing status flips through
   *  here (rather than a bare PATCH) keeps them optimistic AND tracked by
   *  the stale-poll guard, so a poll issued pre-mutation can't briefly
   *  revert the header to the old status. */
  setTurn(next: {
    round?: number;
    activeParticipantId?: string | null;
    status?: 'staging' | 'live' | 'ended';
  }): Promise<void>;
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
  status: null,
  activeParticipantId: null,
  participants: null,
  plans: {},
  participantHp: {},
  participantEconomy: {},
  participantLair: {},
  participantResources: {},
  positions: {},
  boardVersion: null
};

export function connectEncounter(opts: EncounterConnectOptions): ConnectedEncounter {
  const initial: EncounterSnapshot = {
    round: opts.seed?.round ?? EMPTY.round,
    status: opts.seed?.status ?? EMPTY.status,
    activeParticipantId: opts.seed?.activeParticipantId ?? EMPTY.activeParticipantId,
    participants: opts.seed?.participants ?? EMPTY.participants,
    plans: opts.seed?.plans ?? {},
    participantHp: opts.seed?.participantHp ?? {},
    participantEconomy: opts.seed?.participantEconomy ?? {},
    participantLair: opts.seed?.participantLair ?? {},
    participantResources: opts.seed?.participantResources ?? {},
    positions: opts.seed?.positions ?? {},
    boardVersion: opts.seed?.boardVersion ?? null
  };

  const state = writable<EncounterSnapshot>(initial);
  const status = writable<'connecting' | 'open' | 'closed'>('connecting');

  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let consecutiveErrors = 0;

  // --- stale-poll guard ---------------------------------------------------
  // A poll response fetched BEFORE a mutation can land AFTER it and erase
  // the optimistic value until the next poll. Guard with a monotonic
  // mutation counter: `mutationSeq` is bumped when a mutation starts AND
  // when it settles (success or failure), and `mutationsInFlight` counts
  // unsettled mutations. A poll snapshot only applies when no mutation
  // started, settled, or is in flight between the poll being issued and
  // its response arriving. Polls cannot starve: once mutations go
  // quiescent the seq stops moving, so the next poll issued afterwards
  // applies normally.
  let mutationSeq = 0;
  let mutationsInFlight = 0;

  // --- change-token (ETag) --------------------------------------------------
  // The state endpoint sets an ETag over everything the snapshot depends on.
  // Echo it back via If-None-Match so an unchanged poll costs the server a
  // few indexed reads and returns a bodyless 304. Only remembered when a
  // snapshot is actually APPLIED — a snapshot dropped by the stale-poll
  // guard must not advance the ETag, or the next poll would 304 against
  // state the store never received and the re-sync would never happen.
  let lastEtag: string | null = null;

  /** Marks a mutation as started; returns a settle callback for `finally`. */
  function beginMutation(): () => void {
    mutationSeq++;
    mutationsInFlight++;
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      mutationsInFlight--;
      mutationSeq++;
    };
  }

  async function poll() {
    if (destroyed) return;
    const seqAtPollStart = mutationSeq;
    try {
      const res = await fetch(`/api/encounters/${opts.encounterId}/state`, {
        headers: lastEtag ? { 'if-none-match': lastEtag } : undefined
      });
      if (res.status === 304) {
        // Nothing changed server-side. Success — reset error accounting and
        // leave the store (and the stale-poll guard) untouched.
        consecutiveErrors = 0;
        status.set('open');
        return;
      }
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_ERROR_STATUS) {
          status.set('connecting');
        }
        return;
      }
      const data = (await res.json()) as EncounterSnapshot;
      consecutiveErrors = 0;
      if (mutationsInFlight > 0 || mutationSeq !== seqAtPollStart) {
        // Stale snapshot: a mutation raced this poll. Drop the payload —
        // the connection itself is healthy, so still report 'open'; the
        // next post-quiescence poll re-syncs from the server.
        status.set('open');
        return;
      }
      state.set({
        round: data.round,
        status: data.status ?? null,
        activeParticipantId: data.activeParticipantId,
        participants: data.participants ?? null,
        plans: (data.plans ?? {}) as Record<string, TurnPlan>,
        participantHp: (data.participantHp ?? {}) as Record<string, ParticipantHp>,
        participantLair: (data.participantLair ?? {}) as Record<string, boolean>,
        participantEconomy: Object.fromEntries(
          Object.entries(data.participantEconomy ?? {}).map(([pid, e]) => [
            pid,
            normalizeEconomy(e)
          ])
        ),
        participantResources: (data.participantResources ?? {}) as Record<
          string,
          Record<string, number>
        >,
        positions: (data.positions ?? {}) as Record<string, ParticipantPosition>,
        boardVersion: data.boardVersion ?? null
      });
      lastEtag = res.headers.get('etag');
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
      const endMutation = beginMutation();
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
      } finally {
        endMutation();
      }
    },

    async clearPlan(participantId) {
      const endMutation = beginMutation();
      const prev = readPlan(state, participantId);
      // A plain DELETE again. Clearing intent used to have to preserve the
      // combat counters, condition timers and lair marker that shared
      // plan_json — via a rewrite-as-empty-plan dance mirrored on the server.
      // Migration 0009 moved those to combat_state_json, so this endpoint
      // once more does exactly what its name says and nothing else.
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
      } finally {
        endMutation();
      }
    },

    async setEconomy(participantId, characterId, next) {
      const endMutation = beginMutation();
      const snap = readSnap(state);
      const prev = snap.participantEconomy[participantId];
      const prevPlan = snap.plans[participantId];
      state.update((s) => ({
        ...s,
        participantEconomy: { ...s.participantEconomy, [participantId]: next }
      }));
      try {
        if (characterId) {
          // PC: the character document owns these fields. Same write path
          // the encounter page uses for conditions / concentration. Note
          // `spellSlots` is deliberately not written here — it's the NPC
          // tracker's state; a PC's slots are real derive() resources on
          // the sheet.
          const ok = await patchCharacterDocFields(
            characterId,
            economyToCharacterDocFields(next)
          );
          if (!ok) throw new Error('character economy update failed');
        } else {
          // Non-PC: its own column since migration 0009. PATCH merges, so
          // this write can't clobber the lair marker or the condition timers
          // it never read.
          await send(
            `/api/encounters/${opts.encounterId}/participants/${participantId}/combat-state`,
            { method: 'PATCH', body: JSON.stringify({ combat: next }) }
          );
        }
      } catch (err) {
        state.update((s) => {
          const participantEconomy = { ...s.participantEconomy };
          if (prev) participantEconomy[participantId] = prev;
          else delete participantEconomy[participantId];
          const plans = { ...s.plans };
          if (prevPlan) plans[participantId] = prevPlan;
          else delete plans[participantId];
          return { ...s, participantEconomy, plans };
        });
        throw err;
      } finally {
        endMutation();
      }
    },

    async setHp(participantId, hp) {
      const endMutation = beginMutation();
      const prev = readHp(state, participantId);
      state.update((s) => {
        const participantHp = {
          ...s.participantHp,
          [participantId]: {
            currentHp: hp.currentHp !== undefined ? hp.currentHp : prev?.currentHp ?? null,
            tempHp: hp.tempHp !== undefined ? hp.tempHp : prev?.tempHp ?? 0,
            conditions: prev?.conditions ?? [],
            conditionTimers: prev?.conditionTimers,
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
      } finally {
        endMutation();
      }
    },

    async setConditions(participantId, conditions) {
      const endMutation = beginMutation();
      const prev = readHp(state, participantId);
      state.update((s) => {
        const participantHp = {
          ...s.participantHp,
          [participantId]: {
            currentHp: prev?.currentHp ?? null,
            tempHp: prev?.tempHp ?? 0,
            conditions,
            conditionTimers: prev?.conditionTimers,
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
      } finally {
        endMutation();
      }
    },

    async setConditionTimers(participantId, characterId, timers) {
      const endMutation = beginMutation();
      const snap = readSnap(state);
      const prevHp = snap.participantHp[participantId];
      const prevPlan = snap.plans[participantId];
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
              concentrating: cur?.concentrating ?? null,
              conditionTimers: timers
            }
          }
        };
      });
      try {
        if (characterId) {
          const ok = await patchCharacterDocFields(characterId, { conditionTimers: timers });
          if (!ok) throw new Error('character condition-timer update failed');
        } else {
          await send(
            `/api/encounters/${opts.encounterId}/participants/${participantId}/combat-state`,
            { method: 'PATCH', body: JSON.stringify({ conditionTimers: timers }) }
          );
        }
      } catch (err) {
        state.update((s) => {
          const participantHp = { ...s.participantHp };
          if (prevHp) participantHp[participantId] = prevHp;
          else delete participantHp[participantId];
          const plans = { ...s.plans };
          if (prevPlan) plans[participantId] = prevPlan;
          else delete plans[participantId];
          return { ...s, participantHp, plans };
        });
        throw err;
      } finally {
        endMutation();
      }
    },

    async setLair(participantId, lair) {
      const endMutation = beginMutation();
      const prev = readSnap(state).participantLair[participantId] === true;
      state.update((s) => {
        const participantLair = { ...s.participantLair };
        if (lair) participantLair[participantId] = true;
        else delete participantLair[participantId];
        return { ...s, participantLair };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/combat-state`,
          { method: 'PATCH', body: JSON.stringify({ lair }) }
        );
      } catch (err) {
        state.update((s) => {
          const participantLair = { ...s.participantLair };
          if (prev) participantLair[participantId] = true;
          else delete participantLair[participantId];
          return { ...s, participantLair };
        });
        throw err;
      } finally {
        endMutation();
      }
    },

    async setPosition(participantId, pos) {
      const endMutation = beginMutation();
      const snap = readSnap(state);
      const prev = snap.positions[participantId];
      state.update((s) => {
        const positions = { ...s.positions };
        if (pos) {
          positions[participantId] = {
            x: pos.x,
            y: pos.y,
            sizeCells: pos.sizeCells ?? prev?.sizeCells ?? 1
          };
        } else {
          delete positions[participantId];
        }
        return { ...s, positions };
      });
      try {
        await send(
          `/api/encounters/${opts.encounterId}/participants/${participantId}/position`,
          { method: 'POST', body: JSON.stringify(pos ? { x: pos.x, y: pos.y } : { x: null, y: null }) }
        );
      } catch (err) {
        state.update((s) => {
          const positions = { ...s.positions };
          if (prev) positions[participantId] = prev;
          else delete positions[participantId];
          return { ...s, positions };
        });
        throw err;
      } finally {
        endMutation();
      }
    },

    applyDamage(participantId, amount, seed, resolution) {
      const cur = readHp(state, participantId) ?? seed;
      // If a full resolution payload is provided, narrow the incoming
      // amount by the target's predicate-aware resistance/immunity/
      // vulnerability maps before subtracting HP. Otherwise fall back to
      // the legacy unconditional shape so existing call sites are
      // unaffected.
      const effective =
        resolution?.stats
          ? computeIncomingDamage(
              amount,
              resolution.damageType,
              resolution.context ?? {},
              resolution.stats
            )
          : amount;
      const next = applyDamageDelta(cur, effective);
      // fire-and-forget; rollback handled inside setHp on failure
      void this.setHp(participantId, { currentHp: next.currentHp, tempHp: next.tempHp });
      return next;
    },

    async setConcentration(participantId, concentrating) {
      const endMutation = beginMutation();
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
              conditionTimers: cur?.conditionTimers,
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
      } finally {
        endMutation();
      }
    },

    applyHeal(participantId, amount, maxHp, seed) {
      const cur = readHp(state, participantId) ?? seed;
      const next = applyHealDelta(cur, amount, maxHp);
      void this.setHp(participantId, { currentHp: next.currentHp });
      return next;
    },

    async setTurn(next) {
      const endMutation = beginMutation();
      const snap = readSnap(state);
      state.update((s) => ({
        ...s,
        round: next.round !== undefined ? next.round : s.round,
        status: next.status !== undefined ? next.status : s.status,
        activeParticipantId:
          next.activeParticipantId !== undefined ? next.activeParticipantId : s.activeParticipantId
      }));
      try {
        await send(`/api/encounters/${opts.encounterId}`, {
          method: 'PATCH',
          body: JSON.stringify(next)
        });
      } catch (err) {
        state.update((s) => ({
          ...s,
          round: snap.round,
          status: snap.status,
          activeParticipantId: snap.activeParticipantId
        }));
        throw err;
      } finally {
        endMutation();
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
