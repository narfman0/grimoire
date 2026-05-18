// Browser-side Y.Doc + Hocuspocus connection for a single encounter.
//
// Y.Doc shape (room `encounter:<uuid>`):
//
//   Y.Map "encounter"  (M3.3)
//     round                 number   current round counter (0 pre-combat)
//     activeParticipantId   string?  participant whose turn it is, or null
//
//   Y.Map "plans"      (M3.4)
//     <participantId>       string   JSON-encoded TurnPlan blob
//     (Players write their planned action+target+notes into this map;
//      the DM sees plans inline next to each participant on the encounter
//      page. Plans clear themselves out of scope when a new round begins.)
//
// The server flushes the "encounter" map back to the encounters row on
// every store so REST / SSR cold reads stay authoritative. Plans live
// only inside the Y.Doc state blob (no dedicated DB column yet).
//
// Mirrors src/lib/realtime/character-doc.ts but keyed off `encounter:<uuid>`.

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { readable, type Readable } from 'svelte/store';

export interface EncounterSnapshot {
  round: number;
  activeParticipantId: string | null;
  /** Map of participantId → broadcast plan (M3.4). */
  plans: Record<string, TurnPlan>;
}

/** A player's broadcast intent for their next turn. */
export interface TurnPlan {
  /** The slug of the action the player intends to use (derived.actions[].id). */
  actionId: string;
  /** Display label cached on submit so the DM sees something even if the
   *  player isn't connected at look-time. */
  actionLabel: string;
  /** Optional target participant id. Null for "no target" / "self" actions. */
  targetParticipantId: string | null;
  /** Free-text intent. Keep short — UI-side maxlength. */
  notes: string;
  /** ms-epoch when the plan was submitted. */
  updatedAt: number;
}

export interface ConnectedEncounter {
  /** Live Y.Doc — call y.transact / y.observe directly for edits. */
  ydoc: Y.Doc;
  /** Svelte store snapshot of the live encounter state. */
  state: Readable<EncounterSnapshot | null>;
  /** Connection status. */
  status: Readable<'connecting' | 'open' | 'closed' | 'auth-failed'>;
  destroy(): void;
}

export interface EncounterConnectOptions {
  url?: string;
  token: string;
  encounterId: string;
}

function defaultUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:1234';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:1234`;
}

function snapshot(ydoc: Y.Doc): EncounterSnapshot | null {
  const root = ydoc.getMap('encounter');
  if (root.size === 0) return null;
  const plansMap = ydoc.getMap('plans');
  const plans: Record<string, TurnPlan> = {};
  for (const [pid, raw] of plansMap.entries()) {
    if (typeof raw !== 'string') continue;
    try {
      plans[pid] = JSON.parse(raw) as TurnPlan;
    } catch {
      // ignore malformed plan
    }
  }
  return {
    round: Number(root.get('round') ?? 0),
    activeParticipantId: (root.get('activeParticipantId') as string | null | undefined) ?? null,
    plans
  };
}

/**
 * Apply a partial encounter mutation in a single Y transaction so observers
 * see one combined update. Returns the new (locally-computed) state.
 */
export function setEncounterTurn(
  ydoc: Y.Doc,
  next: { round?: number; activeParticipantId?: string | null }
): void {
  const root = ydoc.getMap('encounter');
  ydoc.transact(() => {
    if (next.round !== undefined) root.set('round', next.round);
    if (next.activeParticipantId !== undefined) root.set('activeParticipantId', next.activeParticipantId);
  });
}

/** Publish a player's turn plan into the shared Y.Doc. */
export function setTurnPlan(ydoc: Y.Doc, participantId: string, plan: TurnPlan): void {
  const plans = ydoc.getMap('plans');
  plans.set(participantId, JSON.stringify(plan));
}

/** Clear a player's plan (e.g. after the DM resolves the turn). */
export function clearTurnPlan(ydoc: Y.Doc, participantId: string): void {
  const plans = ydoc.getMap('plans');
  plans.delete(participantId);
}

export function connectEncounterDoc(opts: EncounterConnectOptions): ConnectedEncounter {
  const ydoc = new Y.Doc();
  const url = opts.url ?? defaultUrl();
  const name = `encounter:${opts.encounterId}`;

  let onChange: () => void = () => {};
  let onStatus: (s: 'connecting' | 'open' | 'closed' | 'auth-failed') => void = () => {};

  const state = readable<EncounterSnapshot | null>(null, (set) => {
    onChange = () => set(snapshot(ydoc));
    ydoc.on('update', onChange);
    onChange();
    return () => {
      ydoc.off('update', onChange);
    };
  });

  const status = readable<'connecting' | 'open' | 'closed' | 'auth-failed'>('connecting', (set) => {
    onStatus = set;
    return () => {};
  });

  const provider = new HocuspocusProvider({
    url,
    name,
    document: ydoc,
    token: opts.token,
    onAuthenticationFailed: () => onStatus('auth-failed'),
    onConnect: () => onStatus('open'),
    onClose: () => onStatus('closed')
  });

  return {
    ydoc,
    state,
    status,
    destroy() {
      provider.destroy();
      ydoc.destroy();
    }
  };
}
