// The round the encounter on screen is actually on.
//
// The dice tray lives in the root layout and stamps its "share to table"
// rolls with a round number. It read `$page.data.encounter.round` — the SSR
// value — but rounds advance through `conn.setTurn` and the 2s poll, neither
// of which re-runs the load functions. So a roll shared in round 4 was
// logged as round 1, and the combat log put it in the wrong turn.
//
// The encounter page publishes its live round here; the layout prefers it
// over the SSR seed when the ids match. Guarded by id so a stale value from
// a previously-viewed encounter can never be stamped on another one, and the
// page clears it on unmount.

import { writable } from 'svelte/store';

export const liveEncounterRound = writable<{ encounterId: string; round: number } | null>(null);

/** The round to stamp on a share: the live value when it belongs to this
 *  encounter, the SSR seed otherwise. */
export function roundFor(
  encounterId: string,
  ssrRound: number,
  live: { encounterId: string; round: number } | null
): number {
  return live && live.encounterId === encounterId ? live.round : ssrRound;
}
