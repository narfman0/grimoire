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
  /** Resolved condition slugs — union of character.conditions, their
   *  implied chains (unconscious → prone + incapacitated), and the
   *  condition slugs auto-injected by currently-active activations
   *  (bladesong → 'bladesong-active'). Modifier appliesWhen.condition
   *  checks should test against this set, not character.conditions
   *  directly, so activation gating fires the same as character-set
   *  conditions. Populated as a Set in derive(); evaluateValue doesn't
   *  read it directly today, so it's optional for callers that build a
   *  minimal ctx for token resolution alone (e.g. unit tests). */
  resolvedConditions?: Set<string>;
  /** Computed circumstance slugs currently true for this character
   *  (`hp.below-half`, `wielding.two-handed`, `armor.medium`, …). See
   *  `circumstances.ts`. Populated in derive(): the equipment-derived
   *  members before phase 2, the HP-derived ones right after the HP
   *  maximum is composed. Absent on minimal test contexts, which reads
   *  as "no circumstance holds". */
  circumstances?: Set<string>;
}

const CLASS_LEVEL_TOKEN_RE = /^([a-z][a-z0-9]*)Level$/;
const ARITHMETIC_CHAR_RE = /[+\-*/(),]/;
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
    if (ARITHMETIC_CHAR_RE.test(value)) {
      const parsed = evaluateArithmetic(value, ctx);
      if (parsed !== null) return parsed;
    }
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
  // perAbilityMod: { perAbilityMod: "wis", dieSize: 8 } → "{wisMod}d8" string.
  // Used by sear-undead: roll a number of d8s equal to your Wisdom modifier.
  if (value && typeof value === 'object' && 'perAbilityMod' in value && 'dieSize' in value) {
    const o = value as { perAbilityMod: string; dieSize: number };
    const ab = ABILITY_MOD_TOKENS[`${o.perAbilityMod}Mod`];
    const count = ab !== undefined ? Math.max(1, ctx.abilityMods[ab] ?? 1) : 1;
    return `${count}d${o.dieSize}`;
  }
  // perClassLevel: { perClassLevel: "cleric", multiplier: 5 } → numeric.
  // Used for features whose pool = N × class level (e.g., preserve-life).
  if (value && typeof value === 'object' && 'perClassLevel' in value && 'multiplier' in value) {
    const o = value as { perClassLevel: string; multiplier: number };
    return (ctx.classLevels[o.perClassLevel] ?? 0) * o.multiplier;
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

// Tiny arithmetic grammar for modifier values like "1 + warlockLevel",
// "floor(barbarianLevel/2)", "paladinLevel * 5", "max(1, intMod)".
// Returns null on any parse/eval failure so the caller falls back to the
// raw string (preserving the pre-arithmetic passthrough behavior).
export function evaluateArithmetic(input: string, ctx: EvalContext): number | null {
  const tokens = tokenizeArithmetic(input);
  if (tokens === null) return null;
  const parser = { tokens, pos: 0 };
  const result = parseExpr(parser, ctx);
  if (result === null) return null;
  if (parser.pos !== tokens.length) return null;
  return result;
}

type ArithParser = { tokens: string[]; pos: number };

function tokenizeArithmetic(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (
        j < s.length &&
        ((s[j] >= 'a' && s[j] <= 'z') ||
          (s[j] >= 'A' && s[j] <= 'Z') ||
          (s[j] >= '0' && s[j] <= '9') ||
          s[j] === '_')
      ) {
        j++;
      }
      out.push(s.slice(i, j));
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      out.push(c);
      i++;
      continue;
    }
    return null;
  }
  return out;
}

function peek(p: ArithParser): string | undefined {
  return p.tokens[p.pos];
}

function parseExpr(p: ArithParser, ctx: EvalContext): number | null {
  let left = parseTerm(p, ctx);
  if (left === null) return null;
  while (peek(p) === '+' || peek(p) === '-') {
    const op = p.tokens[p.pos++];
    const right = parseTerm(p, ctx);
    if (right === null) return null;
    left = op === '+' ? left + right : left - right;
  }
  return left;
}

function parseTerm(p: ArithParser, ctx: EvalContext): number | null {
  let left = parseFactor(p, ctx);
  if (left === null) return null;
  while (peek(p) === '*' || peek(p) === '/') {
    const op = p.tokens[p.pos++];
    const right = parseFactor(p, ctx);
    if (right === null) return null;
    if (op === '/') {
      if (right === 0) return null;
      left = left / right;
    } else {
      left = left * right;
    }
  }
  return left;
}

function parseFactor(p: ArithParser, ctx: EvalContext): number | null {
  const t = peek(p);
  if (t === undefined) return null;
  if (t === '-') {
    p.pos++;
    const v = parseFactor(p, ctx);
    return v === null ? null : -v;
  }
  if (t === '+') {
    p.pos++;
    return parseFactor(p, ctx);
  }
  if (t === '(') {
    p.pos++;
    const v = parseExpr(p, ctx);
    if (v === null) return null;
    if (peek(p) !== ')') return null;
    p.pos++;
    return v;
  }
  if (/^[0-9]+$/.test(t)) {
    p.pos++;
    return Number(t);
  }
  if (/^[a-zA-Z_]/.test(t)) {
    p.pos++;
    if (peek(p) === '(') {
      p.pos++;
      const args: number[] = [];
      if (peek(p) !== ')') {
        const first = parseExpr(p, ctx);
        if (first === null) return null;
        args.push(first);
        while (peek(p) === ',') {
          p.pos++;
          const next = parseExpr(p, ctx);
          if (next === null) return null;
          args.push(next);
        }
      }
      if (peek(p) !== ')') return null;
      p.pos++;
      return callArithFn(t, args);
    }
    const resolved = evaluateValue(t, ctx);
    return typeof resolved === 'number' ? resolved : null;
  }
  return null;
}

function callArithFn(name: string, args: number[]): number | null {
  switch (name) {
    case 'floor':
      return args.length === 1 ? Math.floor(args[0]) : null;
    case 'ceil':
      return args.length === 1 ? Math.ceil(args[0]) : null;
    case 'min':
      return args.length >= 1 ? Math.min(...args) : null;
    case 'max':
      return args.length >= 1 ? Math.max(...args) : null;
    default:
      return null;
  }
}
