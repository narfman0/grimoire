// Phase B: pure toggle + refresh helpers for the activation primitive
// (Phase A established the declaration / derived manifest / condition
// injection). These helpers know about group mutual exclusion,
// concentration interruption, per-rest use-tracking, and auto-cancel
// triggers. They return new CharacterDocuments — no I/O, no mutation.
//
// The API layer (Phase C) wraps these for HTTP endpoints; the sheet
// (Phase D) calls them through the existing patchDocument flow.

import type {
  ActivationState,
  AvailableActivation,
  AutoCancelEntry,
  CharacterDocument,
  EquippedInventory
} from './types';

export interface ToggleActivationOpts {
  /** Variant pick when activating a variants[] activation. Ignored on
   *  deactivation. */
  variant?: string;
  /** Cast-slot pick when activating a slot-aware activation (slotScaling
   *  present on the manifest). Ignored on deactivation. */
  slot?: number;
  /** Current encounter round, when toggled inside an encounter. Stored
   *  on activatedAtRound so a future "auto-expire after N rounds" pass
   *  has the start point; v0 ignores it for duration math. */
  currentRound?: number;
}

export type ToggleOutcome =
  /** Activation flipped on (variant set, uses decremented, group/concentration cancellations applied). */
  | 'activated'
  /** Activation flipped off. */
  | 'deactivated'
  /** Already in the requested state — no change. */
  | 'no-op'
  /** Couldn't activate because usesRemaining is 0. */
  | 'no-uses'
  /** Activation id wasn't found in the supplied declarations. */
  | 'unknown';

export interface ToggleActivationResult {
  character: CharacterDocument;
  outcome: ToggleOutcome;
  /** Activation ids auto-cancelled by this toggle (group mutual exclusion
   *  + concentration interruption). Empty when nothing else changed. */
  cancelledIds: string[];
}

/** Flip an activation on or off. Pure: returns a new CharacterDocument.
 *
 *  Takes the runtime `AvailableActivation[]` from Derived (instead of the
 *  source ActivationDeclaration[]) so callers can pass what the sheet
 *  already has on hand.
 *
 *  Activation:
 *  - Looks up the activation in `available` (by id). Returns `unknown`
 *    if not found.
 *  - Returns `no-op` when already in the requested state.
 *  - Returns `no-uses` when activating something with usesRemaining=0.
 *  - Cancels any active activation in the same `group`.
 *  - If concentration: cancels prior concentration (any activation
 *    flagged concentration that's currently active, plus the existing
 *    `character.concentrating` label).
 *  - Decrements usesRemaining by 1 when activating, if uses are declared
 *    (usesMax is not null).
 *  - Stores opts.variant on the state when set.
 *
 *  Deactivation:
 *  - Clears active. Keeps usesRemaining as-is (already decremented on
 *    activation; we don't refund).
 *  - If this activation was the active concentration source, clears
 *    `character.concentrating`.
 */
export function toggleActivation(
  character: CharacterDocument,
  available: AvailableActivation[],
  id: string,
  on: boolean,
  opts: ToggleActivationOpts = {}
): ToggleActivationResult {
  const a = available.find((x) => x.id === id);
  if (!a) {
    return { character, outcome: 'unknown', cancelledIds: [] };
  }
  const activations = character.activations ?? {};
  const current = activations[id];
  const isCurrentlyActive = current?.active === true;

  if (on === isCurrentlyActive) {
    return { character, outcome: 'no-op', cancelledIds: [] };
  }

  if (on) {
    // Activate
    if (current?.usesRemaining !== undefined && current.usesRemaining <= 0) {
      return { character, outcome: 'no-uses', cancelledIds: [] };
    }

    const nextActivations: Record<string, ActivationState> = { ...activations };
    const cancelledIds: string[] = [];

    // Group mutual exclusion: cancel any other active activation in the
    // same group.
    if (a.group) {
      for (const other of available) {
        if (other.id === id) continue;
        if (other.group !== a.group) continue;
        const otherState = nextActivations[other.id];
        if (otherState?.active) {
          nextActivations[other.id] = { ...otherState, active: false };
          cancelledIds.push(other.id);
        }
      }
    }

    // Concentration: cancel prior concentration activations and clear the
    // existing concentrating label.
    let nextConcentrating = character.concentrating ?? null;
    if (a.concentration) {
      for (const other of available) {
        if (other.id === id) continue;
        if (!other.concentration) continue;
        const otherState = nextActivations[other.id];
        if (otherState?.active) {
          nextActivations[other.id] = { ...otherState, active: false };
          if (!cancelledIds.includes(other.id)) cancelledIds.push(other.id);
        }
      }
      nextConcentrating = {
        label: a.name,
        ...(opts.currentRound !== undefined ? { sinceRound: opts.currentRound } : {})
      };
    }

    // Build new state for this activation.
    const newState: ActivationState = { active: true };
    if (current?.usesRemaining !== undefined) {
      newState.usesRemaining = Math.max(0, current.usesRemaining - 1);
    } else if (a.usesMax !== null) {
      newState.usesRemaining = Math.max(0, a.usesMax - 1);
    }
    if (opts.variant !== undefined) {
      newState.variant = opts.variant;
    } else if (current?.variant !== undefined) {
      newState.variant = current.variant;
    }
    if (opts.slot !== undefined) {
      newState.slot = opts.slot;
    } else if (current?.slot !== undefined) {
      newState.slot = current.slot;
    }
    if (opts.currentRound !== undefined) {
      newState.activatedAtRound = opts.currentRound;
    }
    nextActivations[id] = newState;

    return {
      character: {
        ...character,
        activations: nextActivations,
        concentrating: nextConcentrating
      },
      outcome: 'activated',
      cancelledIds
    };
  }

  // Deactivate
  const nextActivations: Record<string, ActivationState> = { ...activations };
  const prev = nextActivations[id];
  nextActivations[id] = {
    ...(prev ?? {}),
    active: false
  };

  // Clear concentration if this activation was the concentration source.
  let nextConcentrating = character.concentrating ?? null;
  if (a.concentration && nextConcentrating?.label === a.name) {
    nextConcentrating = null;
  }

  return {
    character: {
      ...character,
      activations: nextActivations,
      concentrating: nextConcentrating
    },
    outcome: 'deactivated',
    cancelledIds: []
  };
}

/** Refresh per-rest activation uses. `available` is
 *  Derived.availableActivations from the most recent derive() pass —
 *  carries the resolved usesMax we restore to.
 *
 *  Rest semantics:
 *  - short-rest: refreshes activations whose `uses.per === 'short-rest'`
 *  - long-rest: refreshes activations whose `uses.per` is one of
 *    'short-rest' | 'long-rest' | 'day' (long rest is also a short rest;
 *    "next dawn" abilities also refresh on long rest in practice).
 */
export function refreshActivations(
  character: CharacterDocument,
  available: AvailableActivation[],
  restType: 'short-rest' | 'long-rest'
): CharacterDocument {
  const refreshSet =
    restType === 'long-rest'
      ? new Set(['short-rest', 'long-rest', 'day'])
      : new Set(['short-rest']);
  const next: Record<string, ActivationState> = { ...(character.activations ?? {}) };
  let mutated = false;
  for (const a of available) {
    if (a.refreshOn === null) continue;
    if (!refreshSet.has(a.refreshOn)) continue;
    if (a.usesMax === null) continue;
    const cur = next[a.id];
    if (cur?.usesRemaining === a.usesMax) continue;
    next[a.id] = { ...(cur ?? { active: false }), usesRemaining: a.usesMax };
    mutated = true;
  }
  if (!mutated) return character;
  return { ...character, activations: next };
}

/** Walk available activations and toggle off any whose `autoCancelOn`
 *  list matches the character's current conditions[] OR equipped state.
 *  Pure. Called from the sheet whenever conditions[] or equipped
 *  inventory changes (e.g. character becomes incapacitated → Bladesong
 *  drops; character equips a shield → Bladesong drops). String entries
 *  are condition slugs; `{wearing: 'armor.medium'}`-style entries are
 *  inventory predicates evaluated against the supplied equipped state.
 *
 *  `equipped` is required — pass `derived.equipped` from the most
 *  recent derive() pass. Callers that don't track inventory state
 *  (legacy tests, encounter helpers) can pass
 *  `{armorType: null, shield: false}` to disable inventory matching. */
export function applyAutoCancelOnStateChange(
  character: CharacterDocument,
  available: AvailableActivation[],
  equipped: EquippedInventory
): CharacterDocument {
  const activations = character.activations ?? {};
  const conditions = new Set(character.conditions ?? []);
  let result = character;
  for (const a of available) {
    if (!a.autoCancelOn || a.autoCancelOn.length === 0) continue;
    const state = activations[a.id];
    if (!state?.active) continue;
    const triggered = a.autoCancelOn.some((entry) => matchAutoCancel(entry, conditions, equipped));
    if (!triggered) continue;
    const { character: updated } = toggleActivation(result, available, a.id, false);
    result = updated;
  }
  return result;
}

function matchAutoCancel(
  entry: AutoCancelEntry,
  conditions: Set<string>,
  equipped: EquippedInventory
): boolean {
  if (typeof entry === 'string') return conditions.has(entry);
  if (entry && typeof entry === 'object' && 'wearing' in entry) {
    switch (entry.wearing) {
      case 'shield':
        return equipped.shield;
      case 'armor.light':
        return equipped.armorType === 'light';
      case 'armor.medium':
        return equipped.armorType === 'medium';
      case 'armor.heavy':
        return equipped.armorType === 'heavy';
    }
  }
  return false;
}
