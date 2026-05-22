// Evaluator for the small formula language used inside modifier `value`
// fields. v0 supports plain numbers/strings/booleans and a handful of magic
// identifiers that resolve against a context.

import type { AbilityKey, CharacterDocument } from './types';

export interface EvalContext {
  totalLevel: number;
  proficiencyBonus: number;
  rageDamage: number;
  classLevels: Record<string, number>;
  /** Ability modifiers — populated after phase 2(a) of derive composes
   *  ability scores. Tokens `strMod`/`dexMod`/.../`chaMod` resolve here. */
  abilityMods: Record<AbilityKey, number>;
  /** Walking speed in feet — populated after phase 2(d) of derive. Token
   *  `walkSpeed` resolves here (used by e.g. "fly speed = walk speed"). */
  walkSpeed: number;
  /** Current stack count per stackable condition (e.g. exhaustion 1–10).
   *  Used by the perConditionStack evaluator shape. */
  conditionStacks: Record<string, number>;
}

const CLASS_LEVEL_TOKEN_RE = /^([a-z][a-z0-9]*)Level$/;
const ABILITY_MOD_TOKENS: Record<string, AbilityKey> = {
  strMod: 'str',
  dexMod: 'dex',
  conMod: 'con',
  intMod: 'int',
  wisMod: 'wis',
  chaMod: 'cha'
};

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
      case 'walkSpeed':
        return ctx.walkSpeed;
    }
    const ab = ABILITY_MOD_TOKENS[value];
    if (ab !== undefined) return ctx.abilityMods[ab];
    const cls = CLASS_LEVEL_TOKEN_RE.exec(value);
    if (cls) return ctx.classLevels[cls[1]] ?? 0;
    return value;
  }
  if (value && typeof value === 'object' && 'perClass' in value && 'table' in value) {
    const o = value as { perClass: string; table: Array<number | string> };
    const lvl = ctx.classLevels[o.perClass] ?? 0;
    if (lvl < 1) return 0;
    return o.table[Math.min(lvl, o.table.length) - 1] ?? 0;
  }
  // perTotalLevel: { perTotalLevel: true, table: [...] } — indexes by total
  // character level (not a single class level). Same semantics as perClass
  // but uses ctx.totalLevel. Values can be numbers or dice strings.
  if (value && typeof value === 'object' && 'perTotalLevel' in value && 'table' in value) {
    const o = value as { perTotalLevel: unknown; table: Array<number | string> };
    const lvl = ctx.totalLevel;
    if (lvl < 1) return o.table[0] ?? 0;
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
  // sum: { sum: [val1, val2, ...] } — adds resolved numeric values together.
  // Useful for compound amounts like warlockLevel + chaMod.
  if (value && typeof value === 'object' && 'sum' in value) {
    const parts = (value as { sum: unknown }).sum;
    if (Array.isArray(parts)) {
      return parts.reduce<number>((acc, part) => {
        const v = evaluateValue(part, ctx);
        return typeof v === 'number' ? acc + v : acc;
      }, 0);
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
