// The non-intent slots that share `participants.plan_json` with a player's
// declared turn plan: the combat-economy counters (used slots, legendary
// tally, the DM's NPC spell slots), the condition-duration overlay, and the
// lair marker.
//
// They live there because participants have no per-creature combat-state
// column, but they are NOT part of the plan: clearing what a creature
// *intends to do* must never clear what it has *already spent*. An empty
// `actionId` reads as "no plan" to every consumer, so the way to clear a
// plan that carries extras is to rewrite it as an emptied plan rather than
// to drop the column.
//
// Isomorphic and dependency-free on purpose: both the browser channel
// (`clearPlan`) and `DELETE /api/encounters/[id]/participants/[pid]/plan`
// have to apply the same rule. The endpoint is the documented "clear the
// turn plan" contract, so anything that isn't our own client — curl, a
// second client, a future server-side reset — reaches it directly; the
// preservation cannot live only in the browser.

import type { ConditionTimer } from './condition-timers';
import type { CombatEconomy } from '$lib/realtime/economy';

/** Structural shape of a stored turn plan. Matches `TurnPlan`
 *  ($lib/realtime/encounter-channel) and `PlanJson`
 *  ($lib/server/api/encounter-schemas) — kept structural so this module
 *  stays importable from both the browser channel and a route handler. */
export interface PlanLike {
  actionId: string;
  actionLabel: string;
  bonusActionId?: string;
  bonusActionLabel?: string;
  targetParticipantIds: string[];
  bonusTargetParticipantIds?: string[];
  notes: string;
  updatedAt: number;
  combat?: Partial<CombatEconomy>;
  conditionTimers?: ConditionTimer[];
  lair?: boolean;
}

export type PlanExtras = Pick<PlanLike, 'combat' | 'conditionTimers' | 'lair'>;

/** The extras carried by a plan, with absent/empty ones omitted so the
 *  stored JSON stays minimal. */
export function planExtras(plan: PlanLike | null | undefined): PlanExtras {
  return {
    ...(plan?.combat ? { combat: plan.combat } : {}),
    ...(plan?.conditionTimers?.length ? { conditionTimers: plan.conditionTimers } : {}),
    ...(plan?.lair ? { lair: true } : {})
  };
}

/** True when there is state worth preserving through a plan clear. */
export function hasPlanExtras(extras: PlanExtras): boolean {
  return (
    extras.combat != null ||
    (extras.conditionTimers?.length ?? 0) > 0 ||
    extras.lair === true
  );
}

/** Rebuild a plan carrying the same declared intent as `prev` with `extras`
 *  merged over it. */
export function planWithExtras(
  prev: PlanLike | null | undefined,
  extras: PlanExtras,
  now: number = Date.now()
): PlanLike {
  return {
    actionId: prev?.actionId ?? '',
    actionLabel: prev?.actionLabel ?? '',
    ...(prev?.bonusActionId ? { bonusActionId: prev.bonusActionId } : {}),
    ...(prev?.bonusActionLabel ? { bonusActionLabel: prev.bonusActionLabel } : {}),
    targetParticipantIds: prev?.targetParticipantIds ?? [],
    ...(prev?.bonusTargetParticipantIds
      ? { bonusTargetParticipantIds: prev.bonusTargetParticipantIds }
      : {}),
    notes: prev?.notes ?? '',
    updatedAt: now,
    ...planExtras(prev),
    ...extras
  };
}

/** What clearing `prev`'s declared intent should store.
 *
 *  Returns an emptied plan (no action, no targets, no notes — but every
 *  extra intact) when there is state to keep, and null when there isn't,
 *  in which case the caller can drop `plan_json` entirely. */
export function clearedPlan(
  prev: PlanLike | null | undefined,
  now: number = Date.now()
): PlanLike | null {
  const kept = planExtras(prev);
  if (!hasPlanExtras(kept)) return null;
  return {
    actionId: '',
    actionLabel: '',
    targetParticipantIds: [],
    notes: '',
    updatedAt: now,
    ...kept
  };
}
