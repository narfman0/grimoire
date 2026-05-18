// Browser-side Y.Doc + Hocuspocus connection for a single encounter.
//
// M3.3 v0 surface: a root Y.Map called "encounter" with two keys —
//   round                 number   current round counter (0 pre-combat)
//   activeParticipantId   string?  participant whose turn it is, or null
//
// The DM's "next turn" button writes both keys in a single Y transaction;
// every connected client (players + other DM tabs) sees the change within
// one network roundtrip. The server flushes both keys back to the
// encounters row on store, so cold reads + REST PATCH fallbacks stay
// consistent. Per-participant HP / conditions remain on the participants
// table for now and propagate via REST + invalidateAll(); M3.4+ will
// promote those into the Y.Doc as well.
//
// Mirrors src/lib/realtime/character-doc.ts but keyed off `encounter:<uuid>`.
// If we add more shared encounter state (notes, fog-of-war, etc.) the
// snapshot type below grows.

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { readable, type Readable } from 'svelte/store';

export interface EncounterSnapshot {
  round: number;
  activeParticipantId: string | null;
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
  return {
    round: Number(root.get('round') ?? 0),
    activeParticipantId: (root.get('activeParticipantId') as string | null | undefined) ?? null
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
