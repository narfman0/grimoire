// Encounter-scoped, non-PC combat state: what a creature has *already spent*,
// as opposed to what it *intends to do* (that's `plan_json`).
//
// These concerns rode `plan_json` because participants had no column of
// their own. That coupling produced two live defects:
//
//   (a) `DELETE .../participants/[pid]/plan` is documented as "clear the turn
//       plan" and did `.set({ planJson: null })`, destroying the economy, the
//       condition timers and the lair marker with it. The preservation logic
//       lived only in the browser client, so any second client — or a curl
//       against the documented API — got the destructive behaviour.
//   (b) one bad field took down four: the poll `safeParse`d the whole blob,
//       so an over-long `notes` silently zeroed that creature's economy,
//       timers and lair marker for every poller.
//
// Migration 0009 gives it `participants.combat_state_json`. A column can't be
// wiped by a route with no business touching it, and a malformed plan can't
// reach it.
//
// Isomorphic and dependency-free: the browser channel, the poll, the SSR
// loader and the write route all apply the same rules.

import type { ConditionTimer } from './condition-timers';
import type { CombatEconomy } from '$lib/realtime/economy';

export interface CombatState {
  /** Action economy + legendary tally. Round-keyed; stale rounds are already
   *  treated as zero by `legendaryUsedForRound`. */
  combat?: Partial<CombatEconomy>;
  /** Round-scoped condition durations (DM-confirmed, never automatic). */
  conditionTimers?: ConditionTimer[];
  /** DM marker: this creature has lair actions in this encounter. Prep, not
   *  ephemera — which is why the clone route carries it forward. */
  lair?: boolean;
}

/** Legacy read: the same four slots as they were stored on `plan_json`.
 *
 *  Kept for one release so a fight that is *live at the instant of deploy*
 *  doesn't lose its counters mid-session. Writers only ever write the new
 *  column, so the next plan write for a participant drops these keys
 *  naturally and the data converges without a backfill.
 *
 *  Delete this (and the three legacy keys on the PlanJson Zod schema) one
 *  release after 0009 ships. No second migration is needed — residual keys in
 *  `plan_json` are inert text once nothing reads them. */
export function legacyCombatStateFromPlan(plan: unknown): CombatState | null {
  if (!plan || typeof plan !== 'object') return null;
  const p = plan as Record<string, unknown>;
  const out: CombatState = {};
  if (p.combat && typeof p.combat === 'object') out.combat = p.combat as Partial<CombatEconomy>;
  if (Array.isArray(p.conditionTimers)) out.conditionTimers = p.conditionTimers as ConditionTimer[];
  if (p.lair === true) out.lair = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse a stored `combat_state_json`. Returns null for absent or unusable
 *  values so the caller can fall back to the legacy plan keys; never throws,
 *  because a poll must not fail on one bad row. */
export function parseCombatState(raw: string | null | undefined): CombatState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const out: CombatState = {};
  // Per-key salvage, deliberately: this is the shape of defect (b) above, and
  // one unreadable slot must not discard the other three.
  if (p.combat && typeof p.combat === 'object' && !Array.isArray(p.combat)) {
    out.combat = p.combat as Partial<CombatEconomy>;
  }
  if (Array.isArray(p.conditionTimers)) out.conditionTimers = p.conditionTimers as ConditionTimer[];
  if (p.lair === true) out.lair = true;
  return out;
}

/** Read the effective combat state for a participant row, preferring the new
 *  column and falling back to the legacy plan keys for one release. */
export function readCombatState(
  combatStateJson: string | null | undefined,
  planJson: string | null | undefined
): CombatState {
  const fromColumn = parseCombatState(combatStateJson);
  if (fromColumn) return fromColumn;
  if (!planJson) return {};
  try {
    return legacyCombatStateFromPlan(JSON.parse(planJson)) ?? {};
  } catch {
    return {};
  }
}

/** Merge a patch over existing state. Absent keys are left alone; an
 *  explicitly-null key clears that slot. Merge rather than replace so two
 *  concurrent writers — the DM flipping lair while the economy ticks — can't
 *  clobber each other's slot. */
export function mergeCombatState(
  current: CombatState,
  patch: Partial<Record<keyof CombatState, unknown>>
): CombatState {
  const next: CombatState = { ...current };
  for (const key of ['combat', 'conditionTimers', 'lair'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value == null || value === false) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/** Serialize for storage, collapsing empty state to null so a cleared row
 *  drops its column rather than storing `{}`. */
export function serializeCombatState(state: CombatState): string | null {
  const pruned: CombatState = {
    ...(state.combat && Object.keys(state.combat).length > 0 ? { combat: state.combat } : {}),
    ...(state.conditionTimers?.length ? { conditionTimers: state.conditionTimers } : {}),
    ...(state.lair ? { lair: true as const } : {})
  };
  return Object.keys(pruned).length > 0 ? JSON.stringify(pruned) : null;
}
