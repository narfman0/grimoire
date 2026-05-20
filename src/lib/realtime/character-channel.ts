// Browser-side live channel for one character document — short-poll implementation.
//
// Read-only by design: mutations go through PATCH /api/characters/<id>
// (see patchDocument in character/[id]/+page.svelte). The poll channel
// fetches the latest document blob every 2 seconds — typically the owner
// editing on one tab and the DM watching on another.

import { writable, type Readable } from 'svelte/store';
import type { CharacterDocument } from '$lib/rules/types';

export interface ConnectedDoc {
  /** Live snapshot of the character document. Starts as the SSR seed and
   *  updates each time another tab PATCHes. */
  document: Readable<CharacterDocument | null>;
  status: Readable<'connecting' | 'open' | 'closed'>;
  destroy(): void;
}

export interface ConnectOptions {
  characterId: string;
  /** SSR-loaded document to seed the store with, avoiding the null flash
   *  while the first poll resolves. */
  seed?: CharacterDocument | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_ERRORS_BEFORE_RECONNECTING_STATUS = 3;

export function connectCharacter(opts: ConnectOptions): ConnectedDoc {
  const document = writable<CharacterDocument | null>(opts.seed ?? null);
  const status = writable<'connecting' | 'open' | 'closed'>('connecting');

  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let consecutiveErrors = 0;

  async function poll() {
    if (destroyed) return;
    try {
      const res = await fetch(`/api/characters/${opts.characterId}`);
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_RECONNECTING_STATUS) {
          status.set('connecting');
        }
        return;
      }
      const data = (await res.json()) as { document: CharacterDocument | null };
      consecutiveErrors = 0;
      document.set(data.document);
      status.set('open');
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_ERRORS_BEFORE_RECONNECTING_STATUS) {
        status.set('connecting');
      }
    }
  }

  if (typeof window !== 'undefined') {
    // Fire first poll immediately, then on interval
    void poll();
    timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  }

  return {
    document: { subscribe: document.subscribe },
    status: { subscribe: status.subscribe },
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
