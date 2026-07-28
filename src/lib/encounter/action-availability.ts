// Availability of a planner action: can this participant actually take it
// right now? Pure so both the encounter planner (ActionEconomyPanel via
// EncounterPage) and its tests can use it without a Svelte harness.
//
// The *resource* half of the question is answered server-side — the loader
// runs `hasResourceBudget(action, derived.resources)` (the same helper the
// character sheet uses, see $lib/rules/apply-grants) while it still holds
// the full Derived, and ships the verdict plus the pool numbers on each
// PcActionChoice. This module folds that verdict together with the
// participant's live action-economy flags, which the loader can't know
// because they change every turn.

import { slotForCost } from '$lib/rules/action-cost';

/** Resource/economy annotations the loader attaches to a planner action.
 *  Everything is optional so non-PC (statblock) choices, which carry none
 *  of it, fall through as "always available". */
export interface PlannerActionBits {
  /** Action cost — decides which economy slot the pick consumes. */
  cost?: unknown;
  /** Resource pool id this action debits, when it debits one. */
  spendsResource?: string;
  /** Units of `spendsResource` one use costs (defaults to 1). */
  resourceCost?: number;
  /** Display name of the pool ("Ki", "Channel Divinity"). */
  resourceName?: string;
  /** Uses left in the pool at load time; undefined when the action spends
   *  nothing (or the pool couldn't be resolved). */
  resourceRemaining?: number;
  /** Pool size, for the "2/3 left" affordance. */
  resourceMax?: number;
  /** Server verdict from `hasResourceBudget`. Undefined = unknown = allow. */
  affordable?: boolean;
}

/** Which economy slots the participant has already spent this turn. */
export interface EconomyFlags {
  actionUsed?: boolean;
  bonusUsed?: boolean;
  reactionUsed?: boolean;
}

export interface ActionAvailability {
  /** True when the pick should be greyed out / disabled. */
  unavailable: boolean;
  /** Short human reason, or null when available. */
  reason: string | null;
}

const AVAILABLE: ActionAvailability = { unavailable: false, reason: null };

const SLOT_REASON = {
  action: 'no action left',
  bonus: 'no bonus action left',
  reaction: 'no reaction left'
} as const;

/** Decide whether a planner action can be taken, and why not.
 *
 *  Order matters: the economy slot is checked first because "you already
 *  took your action" is the more actionable message — a player who reads
 *  "out of uses" would go looking for a resource problem that isn't the
 *  blocker. */
export function actionAvailability(
  action: PlannerActionBits,
  economy: EconomyFlags | undefined
): ActionAvailability {
  const slot = slotForCost(action.cost);
  if (slot && economy) {
    if (slot === 'action' && economy.actionUsed) return { unavailable: true, reason: SLOT_REASON.action };
    if (slot === 'bonus' && economy.bonusUsed) return { unavailable: true, reason: SLOT_REASON.bonus };
    if (slot === 'reaction' && economy.reactionUsed)
      return { unavailable: true, reason: SLOT_REASON.reaction };
  }
  if (action.affordable === false) {
    const cost = Math.max(1, Math.floor(action.resourceCost ?? 1));
    const remaining = action.resourceRemaining;
    // Nothing left at all reads as "out of uses"; a partially-drained pool
    // that just can't cover this particular action reads as "not enough
    // charges" (a Wand of Fireballs sibling costing 3 with 2 left).
    if (remaining != null && remaining > 0 && remaining < cost) {
      return { unavailable: true, reason: 'not enough charges' };
    }
    return { unavailable: true, reason: 'out of uses' };
  }
  return AVAILABLE;
}

/** Trailing "(1/3 Ki left)"-style annotation for a planner option label.
 *  Empty string when the action spends no resource. */
export function resourceSuffix(action: PlannerActionBits): string {
  if (!action.spendsResource || action.resourceRemaining == null) return '';
  const max = action.resourceMax != null ? `/${action.resourceMax}` : '';
  const name = action.resourceName ? ` ${action.resourceName}` : '';
  return ` — ${action.resourceRemaining}${max}${name} left`;
}

/** Option label for a disabled pick: name plus the reason in parens, so the
 *  reason survives in a `<select>` where a tooltip would not. */
export function labelWithReason(name: string, availability: ActionAvailability): string {
  return availability.reason ? `${name} — ${availability.reason}` : name;
}
