// Runtime application of an Action's side effects onto a CharacterDocument
// draft: the spendsResource debit (honoring resourceCost) plus the
// `Action.grants` payload (temp HP, condition removal, spell-slot
// restoration). Pure: mutates only the passed draft — the sheet's
// patchDocument updater owns persistence, so a single call site produces a
// single document write.
//
// Semantics:
// - temp HP doesn't stack (RAW): the granted amount replaces the current
//   pool only when higher. Dice-formula grants ('1d4+4') can't be rolled
//   here (the engine has no RNG) — they're surfaced on `manual` for the
//   player to roll and set by hand.
// - removeConditions: a plain string (or `{ condition }` with no stacks)
//   removes the condition entirely; `{ condition, stacks: N }` decrements
//   `conditionStacks` by N and removes the condition when it reaches 0.
// - stabilizeTarget: aimed at another creature, so the draft is never
//   touched — the grant surfaces on `manual` for the player to apply.
// - restoreSpellSlots: 'level N or lower' pick-best — each of `count`
//   restores un-spends the highest-level slot ≤ N that has a spent use,
//   clamped at 0 spent (restores stop when nothing eligible remains).

import type { ActionGrants, CharacterDocument } from './types';

/** The Action fields this module reads — kept structural so serialized
 *  action shapes (the sheet's SerializedDerived rows) qualify too. */
export interface UsableActionBits {
  spendsResource?: string;
  resourceCost?: number;
  grants?: ActionGrants;
}

/** Minimal view of a resolved resource pool (Derived.resources rows). */
export interface ResourcePoolView {
  id: string;
  name?: string;
  max: number;
  used: number;
}

export interface ApplyActionUseContext {
  /** Derived.resources — sizes the spendsResource debit. */
  resources: ResourcePoolView[];
  /** Derived.stats.spellSlots — which slot levels exist and their max,
   *  for restoreSpellSlots clamping. */
  spellSlots: Record<number, { max: number; used: number }>;
}

/** True when the action's spendsResource pool (if any) still holds at
 *  least `resourceCost` uses. Actions without spendsResource always fit;
 *  an action pointing at an unknown pool doesn't (can't debit what isn't
 *  there). */
export function hasResourceBudget(
  action: UsableActionBits,
  resources: ResourcePoolView[]
): boolean {
  if (!action.spendsResource) return true;
  const pool = resources.find((r) => r.id === action.spendsResource);
  if (!pool) return false;
  const cost = Math.max(1, Math.floor(action.resourceCost ?? 1));
  return pool.max - pool.used >= cost;
}

export interface ApplyActionUseResult {
  /** Human-readable summaries of what the call changed ('+5 temp HP',
   *  'removed poisoned', 'restored 1 level-3 slot', 'spent 2 charges'). */
  applied: string[];
  /** Follow-ups the player must do by hand (dice-formula temp HP). */
  manual: string[];
}

const slotKey = (level: number): string => `spell-slot/L${level}`;

/** Apply one use of `action` to the draft: debit its resource pool and
 *  fold its grants into character state. Returns summary lines for the
 *  caller's feedback surface (toast). Mutates `d`; persists nothing. */
export function applyActionUse(
  d: CharacterDocument,
  action: UsableActionBits,
  ctx: ApplyActionUseContext
): ApplyActionUseResult {
  const applied: string[] = [];
  const manual: string[] = [];

  // ---- spendsResource debit (resourceCost, default 1) ----
  if (action.spendsResource) {
    const pool = ctx.resources.find((r) => r.id === action.spendsResource);
    if (pool) {
      const cost = Math.max(1, Math.floor(action.resourceCost ?? 1));
      d.resourcesSpent ??= {};
      const current = Math.max(0, d.resourcesSpent[pool.id] ?? 0);
      const next = Math.min(pool.max, current + cost);
      if (next !== current) {
        d.resourcesSpent[pool.id] = next;
        applied.push(`spent ${next - current} ${pool.name ?? pool.id}`);
      }
    }
  }

  const grants = action.grants;
  if (!grants) return { applied, manual };

  // ---- temp HP (no stacking — take the max, RAW) ----
  if (grants.tempHp != null) {
    if (typeof grants.tempHp === 'number') {
      const current = d.tempHp ?? 0;
      if (grants.tempHp > current) {
        d.tempHp = grants.tempHp;
        applied.push(`+${grants.tempHp} temp HP`);
      } else {
        applied.push(`temp HP kept at ${current} (already higher)`);
      }
    } else if (typeof grants.tempHp === 'string' && grants.tempHp.length > 0) {
      manual.push(`roll ${grants.tempHp} temp HP and set it on the sheet`);
    }
  }

  // ---- condition removal / stack decrement ----
  for (const entry of grants.removeConditions ?? []) {
    const condition = typeof entry === 'string' ? entry : entry.condition;
    const stacks = typeof entry === 'string' ? undefined : entry.stacks;
    const hasCondition =
      d.conditions.includes(condition) || (d.conditionStacks?.[condition] ?? 0) > 0;
    if (!hasCondition) continue;
    if (stacks == null) {
      d.conditions = d.conditions.filter((c) => c !== condition);
      if (d.conditionStacks) delete d.conditionStacks[condition];
      applied.push(`removed ${condition}`);
    } else {
      // A present condition with no stack record counts as 1 stack.
      const current = d.conditionStacks?.[condition] ?? 1;
      const next = current - stacks;
      if (next <= 0) {
        d.conditions = d.conditions.filter((c) => c !== condition);
        if (d.conditionStacks) delete d.conditionStacks[condition];
        applied.push(`removed ${condition}`);
      } else {
        d.conditionStacks ??= {};
        d.conditionStacks[condition] = next;
        applied.push(`${condition} reduced to ${next}`);
      }
    }
  }

  // ---- stabilize a target (Spare the Dying) ----
  // Aimed at another creature, so nothing on this draft changes; the
  // follow-up is the player's/DM's to apply on the target's sheet.
  if (grants.stabilizeTarget === true) {
    manual.push('stabilize the target (0 HP, no longer making death saves)');
  }

  // ---- spell-slot restoration ('level N or lower', pick-best) ----
  if (grants.restoreSpellSlots) {
    const { level, count } = grants.restoreSpellSlots;
    const restores = Math.max(1, Math.floor(count ?? 1));
    const restoredByLevel = new Map<number, number>();
    for (let i = 0; i < restores; i += 1) {
      const eligible = Object.keys(ctx.spellSlots)
        .map(Number)
        .filter((l) => l >= 1 && l <= level)
        .sort((a, b) => b - a);
      let restored = false;
      for (const l of eligible) {
        const max = ctx.spellSlots[l]?.max ?? 0;
        const spent = Math.min(max, Math.max(0, d.resourcesSpent?.[slotKey(l)] ?? 0));
        if (spent <= 0) continue;
        d.resourcesSpent ??= {};
        d.resourcesSpent[slotKey(l)] = spent - 1;
        restoredByLevel.set(l, (restoredByLevel.get(l) ?? 0) + 1);
        restored = true;
        break;
      }
      if (!restored) break; // nothing spent at or below `level`
    }
    for (const [l, n] of [...restoredByLevel.entries()].sort((a, b) => b[0] - a[0])) {
      applied.push(`restored ${n} level-${l} slot${n === 1 ? '' : 's'}`);
    }
  }

  return { applied, manual };
}
