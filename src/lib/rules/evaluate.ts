// Evaluator for the small formula language used inside modifier `value`
// fields. v0 supports plain numbers/strings/booleans and a handful of magic
// identifiers that resolve against a context.

import type { CharacterDocument } from './types';

export interface EvalContext {
  totalLevel: number;
  proficiencyBonus: number;
  rageDamage: number;
}

/**
 * Resolve a modifier value against the current context.
 *
 * Numbers/booleans/objects pass through. Strings get matched against magic
 * names; unknown strings pass through unchanged (the caller decides what to
 * do with non-numeric values).
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
