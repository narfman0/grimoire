// Browser-side live channel for one character document.
//
// Read-only by design: mutations go through PATCH /api/characters/<id>
// (see patchDocument in character/[id]/+page.svelte). The SSE channel
// streams the latest document blob to all viewers — typically the owner
// editing on one tab
// and the DM watching on another.

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
   *  while SSE warms up. */
  seed?: CharacterDocument | null;
}

type ServerEvent = {
  type: 'document';
  name: string;
  document: CharacterDocument | null;
  updatedAt: number;
};

export function connectCharacter(opts: ConnectOptions): ConnectedDoc {
  const document = writable<CharacterDocument | null>(opts.seed ?? null);
  const status = writable<'connecting' | 'open' | 'closed'>('connecting');

  let es: EventSource | null = null;
  let destroyed = false;

  function open() {
    if (destroyed || typeof window === 'undefined') return;
    es = new EventSource(`/api/characters/${opts.characterId}/stream`);
    es.onopen = () => status.set('open');
    es.onerror = () => status.set('connecting');
    es.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data) as ServerEvent;
        if (payload.type === 'document') document.set(payload.document);
      } catch {
        // ignore malformed event
      }
    };
  }

  open();

  return {
    document: { subscribe: document.subscribe },
    status: { subscribe: status.subscribe },
    destroy() {
      destroyed = true;
      es?.close();
      es = null;
      status.set('closed');
    }
  };
}
