// Browser-side Y.Doc + Hocuspocus connection for a single character.
//
// Sync model: the server hydrates the Y.Doc from `characters.document`
// JSON on first load (sync-server onLoadDocument). The browser connects
// to room `character:<id>`, observes the Y.Doc, and surfaces a snapshot
// CharacterDocument for the page to render. As of M2.3, HP / tempHp
// edits flow through the Y.Doc via setDocField() and propagate to other
// tabs in real time. Structural edits still go through PATCH.

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { readable, type Readable } from 'svelte/store';
import type { CharacterDocument } from '$lib/rules/types';

export interface ConnectedDoc {
  /** Live Y.Doc — call y.transact / y.observe directly for edits. */
  ydoc: Y.Doc;
  /** Svelte store snapshot of the current CharacterDocument value. */
  document: Readable<CharacterDocument | null>;
  /** Connection status: 'connecting' | 'open' | 'closed' | 'auth-failed'. */
  status: Readable<'connecting' | 'open' | 'closed' | 'auth-failed'>;
  /** Tear down the websocket + listeners. */
  destroy(): void;
}

export interface ConnectOptions {
  /** Defaults to `ws://${location.hostname}:47474` when run in browser. */
  url?: string;
  /** Session id from the grimoire_session cookie (the page needs to expose this — see below). */
  token: string;
  /** Character UUID. */
  characterId: string;
}

function defaultUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:47474';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:47474`;
}

/**
 * Decode the live Y.Doc into a CharacterDocument. v0 stores each
 * top-level field as a JSON-encoded string inside the root Y.Map,
 * matching the sync-server's onLoadDocument hydration shape.
 */
function snapshot(ydoc: Y.Doc): CharacterDocument | null {
  const root = ydoc.getMap('document');
  if (root.size === 0) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of root.entries()) {
    if (typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out as unknown as CharacterDocument;
}

export function connectCharacterDoc(opts: ConnectOptions): ConnectedDoc {
  const ydoc = new Y.Doc();
  const url = opts.url ?? defaultUrl();
  const name = `character:${opts.characterId}`;

  let onChange: () => void = () => {};
  let onStatus: (s: 'connecting' | 'open' | 'closed' | 'auth-failed') => void = () => {};

  const document = readable<CharacterDocument | null>(null, (set) => {
    onChange = () => set(snapshot(ydoc));
    ydoc.on('update', onChange);
    onChange();
    return () => {
      ydoc.off('update', onChange);
    };
  });

  const status = readable<'connecting' | 'open' | 'closed' | 'auth-failed'>(
    'connecting',
    (set) => {
      onStatus = set;
      return () => {};
    }
  );

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
    document,
    status,
    destroy() {
      provider.destroy();
      ydoc.destroy();
    }
  };
}
