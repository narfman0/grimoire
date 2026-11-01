// Browser-side live channel for the party dashboard — 2s short-poll, same
// model as character-channel / encounter-channel. Read-only; the table view's
// DM controls mutate through the normal routes (via the `api` helper) and
// call `refresh()` so the change shows without waiting for the next tick.
//
// Polls use raw fetch rather than the `api` helper on purpose, like the other
// channels: a dropped poll is routine on a phone and must not toast.

import { writable, type Readable } from 'svelte/store';
import type { PartyDashboard } from '$lib/dashboard/types';

export type DashboardStatus = 'connecting' | 'open' | 'gone' | 'closed';

export interface ConnectedDashboard {
  data: Readable<PartyDashboard>;
  /** 'gone' = the server answered 404/403: the spectator link was revoked or
   *  regenerated (or membership ended). Polling stops. */
  status: Readable<DashboardStatus>;
  refresh(): Promise<void>;
  destroy(): void;
}

const POLL_INTERVAL_MS = 2000;
const MAX_ERRORS_BEFORE_RECONNECTING_STATUS = 3;

export function connectDashboard(opts: { url: string; seed: PartyDashboard }): ConnectedDashboard {
  const data = writable<PartyDashboard>(opts.seed);
  const status = writable<DashboardStatus>('connecting');
  let timer: ReturnType<typeof setInterval> | null = null;
  let etag: string | null = null;
  let destroyed = false;
  let errors = 0;

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function poll() {
    if (destroyed) return;
    try {
      const res = await fetch(opts.url, {
        headers: etag ? { 'if-none-match': etag } : {}
      });
      if (res.status === 304) {
        errors = 0;
        status.set('open');
        return;
      }
      if (res.status === 404 || res.status === 403 || res.status === 401) {
        stop();
        status.set('gone');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as PartyDashboard;
      if (destroyed) return;
      etag = res.headers.get('etag');
      errors = 0;
      data.set(body);
      status.set('open');
    } catch {
      errors++;
      if (errors >= MAX_ERRORS_BEFORE_RECONNECTING_STATUS) status.set('connecting');
    }
  }

  if (typeof window !== 'undefined') {
    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  return {
    data: { subscribe: data.subscribe },
    status: { subscribe: status.subscribe },
    refresh: poll,
    destroy() {
      destroyed = true;
      stop();
      status.set('closed');
    }
  };
}
