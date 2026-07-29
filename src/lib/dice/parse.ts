import type { DiceExpr, DiceTerm } from './types';

// Formula parsing. Deliberately small: 5e notation is `NdS`, a flat modifier,
// and keep-highest/lowest for ability-score generation. Everything exotic
// (exploding dice, fudge dice, nested parens) is a non-goal — see
// docs/proposals/dice-roller.md.
//
// Accepted: `d20`, `2d6+3`, `1d8-1`, `4d6kh3`, `2d20kl1`, `1d20+2d6+5`, `7`.
// Rejected (null, never a throw): empty input, subtracted dice pools, absurd
// counts, malformed keeps. Callers surface null as "that isn't a formula"
// rather than crashing on user input from the tray's free-text box.

/** Bounds. These exist to stop a typo like `999999d100` from hanging a tab,
 *  not because any real formula approaches them. */
const MAX_COUNT = 100;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;

const TOKEN =
  /([+-]?)(?:(\d*)[dD](\d+)(?:([kK][hHlL])(\d*))?|(\d+))/g;

/**
 * Parse a dice formula. Returns null when the string isn't one — including
 * partially-valid input like `2d6 banana`, which must not silently roll 2d6.
 */
export function parseDice(input: string): DiceExpr | null {
  if (typeof input !== 'string') return null;
  const source = input.trim();
  if (source === '') return null;

  // Whitespace is noise everywhere in this grammar; strip it so the
  // full-coverage check below is a simple index comparison.
  const compact = source.replace(/\s+/g, '');
  if (compact.length > 200) return null;

  const terms: DiceTerm[] = [];
  let flat = 0;
  let cursor = 0;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(compact)) !== null) {
    // A gap between tokens means unparseable junk sits in it.
    if (match.index !== cursor) return null;
    cursor = TOKEN.lastIndex;

    const [, sign, countRaw, sidesRaw, keepKindRaw, keepCountRaw, constRaw] = match;
    const negative = sign === '-';

    if (constRaw !== undefined) {
      const value = Number(constRaw);
      if (!Number.isSafeInteger(value)) return null;
      flat += negative ? -value : value;
      continue;
    }

    // Dice pools are additive only. `1d8-1d4` parses cleanly but has no 5e
    // meaning, and allowing it would put signs on every die in the result.
    if (negative) return null;

    const count = countRaw === '' ? 1 : Number(countRaw);
    const sides = Number(sidesRaw);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
    if (!Number.isInteger(sides) || sides < 1 || sides > MAX_SIDES) return null;

    const term: DiceTerm = { count, sides };

    if (keepKindRaw) {
      // Bare `kh` keeps 1 — the common shorthand for advantage-style pools.
      const keepCount = keepCountRaw === '' ? 1 : Number(keepCountRaw);
      if (!Number.isInteger(keepCount) || keepCount < 1 || keepCount > count) return null;
      term.keep = {
        count: keepCount,
        from: keepKindRaw[1].toLowerCase() === 'h' ? 'highest' : 'lowest'
      };
    }

    terms.push(term);
    if (terms.length > MAX_TERMS) return null;
  }

  // Trailing junk, or nothing matched at all.
  if (cursor !== compact.length) return null;
  if (terms.length === 0 && !/\d/.test(compact)) return null;

  return { terms, flat, source };
}

/** Average result of a formula, without rolling. Used for hit-dice previews
 *  and "you could take the average instead" affordances. Dice average
 *  `(sides + 1) / 2`; keep-pools are approximated by their kept count, which
 *  is wrong for `kh`/`kl` but only ever used for display. */
export function averageOf(expr: DiceExpr): number {
  let total = expr.flat;
  for (const t of expr.terms) {
    const kept = t.keep ? t.keep.count : t.count;
    total += (kept * (t.sides + 1)) / 2;
  }
  return total;
}

/** Re-emit a parsed expression in canonical form (`2d6+1d4+3`). */
export function formatExpr(expr: DiceExpr): string {
  const parts = expr.terms.map((t) => {
    const keep = t.keep ? `k${t.keep.from === 'highest' ? 'h' : 'l'}${t.keep.count}` : '';
    return `${t.count}d${t.sides}${keep}`;
  });
  let out = parts.join('+');
  if (expr.flat > 0) out += `${out ? '+' : ''}${expr.flat}`;
  else if (expr.flat < 0) out += `${expr.flat}`;
  return out === '' ? '0' : out;
}
