// Evaluator for the small formula language used inside modifier `value`
// fields. v0 supports plain numbers/strings/booleans and a handful of magic
// identifiers that resolve against a context.

import type { CharacterDocument } from './types';

export interface EvalContext {
  totalLevel: number;
  proficiencyBonus: number;
  rageDamage: number;
  classLevels: Record<string, number>;
  /** Current stack count per stackable condition (e.g. exhaustion 1–10).
   *  Used by the perConditionStack evaluator shape. */
  conditionStacks: Record<string, number>;
}

/**
 * Resolve a modifier value against the current context.
 *
 * Numbers / booleans pass through. Strings match magic identifiers; unknown
 * strings pass through unchanged. Objects of shape
 *   { perClass: string, table: number[] }
 * resolve to `table[classLevels[perClass] - 1]` for class-level-scaled values
 * (e.g., barbarian rages per day).
 */
export function evaluateValue(value: unknown, ctx: EvalContext): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    switch (value) {
      case 'totalLevel':
        return ctx.totalLevel;
      case 'proficiencyBonus':
        return ctx.proficiencyBonus;
      case 'rageDamage':
        return ctx.rageDamage;
      default:
        return value;
    }
  }
  if (value && typeof value === 'object' && 'perClass' in value && 'table' in value) {
    const o = value as { perClass: string; table: number[] };
    const lvl = ctx.classLevels[o.perClass] ?? 0;
    if (lvl < 1) return 0;
    return o.table[Math.min(lvl, o.table.length) - 1] ?? 0;
  }
  // perConditionStack: { perConditionStack: "exhaustion", perLevel: -2 }
  // Evaluates to conditionStacks[slug] * perLevel, or 0 if not stacked.
  if (
    value &&
    typeof value === 'object' &&
    'perConditionStack' in value &&
    'perLevel' in value
  ) {
    const o = value as { perConditionStack: string; perLevel: number };
    const stacks = ctx.conditionStacks[o.perConditionStack] ?? 0;
    return stacks === 0 ? 0 : stacks * o.perLevel;
  }
  return value;
}

export function proficiencyBonusFor(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** 2024 Barbarian rage damage = proficiency bonus. */
export function rageDamageFor(_char: CharacterDocument, proficiencyBonus: number): number {
  return proficiencyBonus;
}
