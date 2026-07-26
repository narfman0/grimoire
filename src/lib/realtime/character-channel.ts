// Browser-side live channel for one character document — short-poll implementation.
//
// Read-only by design: mutations go through PATCH /api/characters/<id>
// (see patchDocument in character/[id]/+page.svelte). The poll channel
// fetches the latest document blob every 2 seconds — typically the owner
// editing on one tab and the DM watching on another. Pages that PATCH
// locally should call `noteMutation(patchPromise)` so stale poll
// responses issued before/during the PATCH don't clobber the local edit.

import { writable, type Readable } from 'svelte/store';
import type { CharacterDocument } from '$lib/rules/types';

export interface ConnectedDoc {
  /** Live snapshot of the character document. Starts as the SSR seed and
   *  updates each time another tab PATCHes. */
  document: Readable<CharacterDocument | null>;
  /** Server `updatedAt` (ms since epoch) accompanying the document snapshot —
   *  the optimistic-concurrency token pages send back as `baseUpdatedAt` on
   *  PATCH. Null until seeded or until the first poll that carries one.
   *  Updated under the same stale-poll guard as `document` so the token and
   *  the snapshot never diverge. */
  updatedAt: Readable<number | null>;
  status: Readable<'connecting' | 'open' | 'closed'>;
  /** Signal that a local mutation (PATCH /api/characters/<id>) is starting.
   *  Call this right before issuing the PATCH so poll responses fetched
   *  earlier — which may carry a pre-mutation snapshot — are dropped
   *  instead of clobbering the locally-updated document. Pass the PATCH's
   *  promise (`settled`) so polls in flight *during* the request are also
   *  dropped; polls issued after the promise settles apply normally, so
   *  the channel re-syncs from the server once mutations go quiescent. */
  noteMutation(settled?: Promise<unknown>): void;
  destroy(): void;
}

export interface ConnectOptions {
  characterId: string;
  /** SSR-loaded document to seed the store with, avoiding the null flash
   *  while the first poll resolves. */
  seed?: CharacterDocument | null;
  /** Server `updatedAt` (ms) matching `seed`, seeding the updatedAt store. */
  seedUpdatedAt?: number | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_ERRORS_BEFORE_RECONNECTING_STATUS = 3;

export function connectCharacter(opts: ConnectOptions): ConnectedDoc {
  const document = writable<CharacterDocument | null>(opts.seed ?? null);
  const updatedAt = writable<number | null>(opts.seedUpdatedAt ?? null);
  const status = writable<'connecting' | 'open' | 'closed'>('connecting');

  let timer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let consecutiveErrors = 0;

  // --- stale-poll guard ---------------------------------------------------
  // A poll response fetched BEFORE a local PATCH can land AFTER it and
  // overwrite the store with a pre-mutation document until the next poll.
  // Same pattern as encounter-channel: a monotonic `mutationSeq` bumped
  // when a mutation starts and again when it settles, plus an in-flight
  // count. A poll snapshot only applies when no mutation started, settled,
  // or is in flight between the poll being issued and its response
  // arriving. Once mutations go quiescent the seq stops moving, so the
  // next poll applies — polls can never starve forever.
  let mutationSeq = 0;
  let mutationsInFlight = 0;

  function noteMutation(settled?: Promise<unknown>) {
    mutationSeq++;
    if (!settled) return;
    mutationsInFlight++;
    void settled.finally(() => {
      mutationsInFlight--;
      mutationSeq++;
    });
  }

  async function poll() {
    if (destroyed) return;
    const seqAtPollStart = mutationSeq;
    try {
      const res = await fetch(`/api/characters/${opts.characterId}`);
      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_ERRORS_BEFORE_RECONNECTING_STATUS) {
          status.set('connecting');
        }
        return;
      }
      const data = (await res.json()) as {
        document: CharacterDocument | null;
        updatedAt?: number;
      };
      consecutiveErrors = 0;
      if (mutationsInFlight > 0 || mutationSeq !== seqAtPollStart) {
        // Stale snapshot: a local mutation raced this poll. Drop the
        // payload — the connection itself is healthy, so still report
        // 'open'; the next post-quiescence poll re-syncs from the server.
        status.set('open');
        return;
      }
      document.set(data.document);
      if (typeof data.updatedAt === 'number') updatedAt.set(data.updatedAt);
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
    updatedAt: { subscribe: updatedAt.subscribe },
    status: { subscribe: status.subscribe },
    noteMutation,
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
