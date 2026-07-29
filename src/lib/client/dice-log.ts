import { writable } from 'svelte/store';
import type { RollResult } from '$lib/dice';

// Shared recent-roll history. Client-only and deliberately not persisted:
// this answers "wait, what did I actually roll" for the last few minutes, it
// is not an audit trail. The audit trail is `action_log`, and a roll only
// reaches it when someone explicitly shares it to the table.
//
// Lives in $lib/client rather than inside the tray component so every roll
// surface (sheet skill rolls, resolve panel, the tray itself) can feed the
// same list — a player who rolls Stealth on their sheet should see it in the
// tray history without the two components knowing about each other.

export interface LoggedRoll {
  id: number;
  /** What was rolled: a skill name, an action name, or the raw formula. */
  label: string;
  result: RollResult;
}

/** Enough to cover a round of combat; old entries fall off the end. */
const MAX_ENTRIES = 20;

let nextId = 0;

export const diceLog = writable<LoggedRoll[]>([]);

/** Record a roll, newest first. Returns the entry so a caller can offer to
 *  share that specific roll. */
export function recordRoll(label: string, result: RollResult): LoggedRoll {
  const entry: LoggedRoll = { id: nextId++, label, result };
  diceLog.update((list) => [entry, ...list].slice(0, MAX_ENTRIES));
  return entry;
}

export function clearDiceLog(): void {
  diceLog.set([]);
}

/** Test seam — resets the id counter so assertions can rely on ids. */
export function resetDiceLog(): void {
  nextId = 0;
  diceLog.set([]);
}
