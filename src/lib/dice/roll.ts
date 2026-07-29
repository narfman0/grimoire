import { parseDice } from './parse';
import { defaultRng } from './rng';
import type { D20Options, DiceExpr, PoolOptions, RollResult, RolledDie, Rng } from './types';

// The evaluator. Two entry points because 5e has two shapes of roll and they
// take genuinely different modifiers:
//
//   rollD20  — attack, check, save, initiative, death save. Advantage,
//              floors, crit thresholds.
//   rollPool — damage, healing, hit dice, free-form formulas. Per-die floors,
//              maximize, crit doubling, whole-pool rerolls.
//
// Trying to serve both from one signature meant guessing which options applied
// to which dice in a mixed formula like `1d20+2d6+5`. Two functions, no magic.

/** One die face from an Rng, guarding a source that returns exactly 1. */
function rollOne(sides: number, rng: Rng): number {
  const r = rng();
  const clamped = !Number.isFinite(r) || r < 0 ? 0 : r >= 1 ? 0.999999999999 : r;
  return 1 + Math.floor(clamped * sides);
}

const sumKept = (dice: RolledDie[]) =>
  dice.reduce((acc, d) => acc + (d.kept ? d.value : 0), 0);

/** Render `[18, (7)] + 5 = 23`. Dropped dice are parenthesized; a die whose
 *  value was altered shows the change (`3→10`) so a floor is visible rather
 *  than silently improving someone's luck. */
function formatDetail(dice: RolledDie[], flat: number, total: number): string {
  const faces = dice.map((d) => {
    const shown = d.raw != null ? `${d.raw}→${d.value}` : `${d.value}`;
    return d.kept ? shown : `(${shown})`;
  });
  const pool = faces.length > 0 ? `[${faces.join(', ')}]` : '';
  const mod = flat === 0 ? '' : flat > 0 ? ` + ${flat}` : ` - ${Math.abs(flat)}`;
  return `${pool}${mod} = ${total}`.trim();
}

/** Mark the `keep.count` best (or worst) dice of a pool as kept. */
function applyKeep(pool: RolledDie[], keep: { count: number; from: 'highest' | 'lowest' }): void {
  const order = [...pool].sort((a, b) =>
    keep.from === 'highest' ? b.value - a.value : a.value - b.value
  );
  const survivors = new Set(order.slice(0, keep.count));
  for (const die of pool) die.kept = survivors.has(die);
}

function makeDie(
  sides: number,
  opts: Pick<PoolOptions, 'dieMin' | 'maximize'>,
  rng: Rng,
  origin?: RolledDie['origin']
): RolledDie {
  const die: RolledDie = { sides, value: 0, kept: true, ...(origin ? { origin } : {}) };

  // Maximize wins over dieMin — a maximized die is already at its ceiling, and
  // rolling it just to discard the result would consume RNG a test can see.
  if (opts.maximize) {
    die.value = sides;
    die.maximized = true;
    return die;
  }

  const rolled = rollOne(sides, rng);
  die.value = rolled;
  // Great Weapon Fighting floors each die on its own; flooring the total
  // instead would be a materially different (and better) rule.
  if (opts.dieMin != null && rolled < opts.dieMin) {
    die.raw = rolled;
    die.value = opts.dieMin;
  }
  return die;
}

/** Roll every term once. Crit doubling repeats the whole term list; the crit
 *  extra die is appended afterwards so doubling never applies to it. */
function rollTerms(expr: DiceExpr, opts: PoolOptions, rng: Rng): RolledDie[] {
  const out: RolledDie[] = [];
  const passes = opts.doubleDice ? 2 : 1;

  for (let pass = 0; pass < passes; pass++) {
    for (const term of expr.terms) {
      const pool: RolledDie[] = [];
      for (let i = 0; i < term.count; i++) {
        pool.push(makeDie(term.sides, opts, rng, pass === 1 ? 'crit' : undefined));
      }
      if (term.keep) applyKeep(pool, term.keep);
      out.push(...pool);
    }
  }

  const extra = opts.extraDice ?? 0;
  if (extra > 0 && expr.terms.length > 0) {
    // Savage Attacks adds *weapon* dice; in a mixed formula (1d8 slashing +
    // 1d6 fire) that's the first term. Content authors put the weapon die
    // first, and there's no field saying otherwise.
    const sides = expr.terms[0].sides;
    for (let i = 0; i < extra; i++) out.push(makeDie(sides, opts, rng, 'crit'));
  }

  return out;
}

function rollBonusDice(formulas: string[] | undefined, rng: Rng): RolledDie[] {
  const out: RolledDie[] = [];
  for (const formula of formulas ?? []) {
    const expr = parseDice(formula);
    if (!expr) continue; // an unparseable bonus die is ignored, never fatal
    for (const term of expr.terms) {
      for (let i = 0; i < term.count; i++) {
        out.push({ ...makeDie(term.sides, {}, rng), origin: 'bonus' });
      }
    }
  }
  return out;
}

/**
 * Roll a dice pool: damage, healing, hit dice, or anything typed into the
 * free-form box. Returns null when `formula` is a string that doesn't parse.
 */
export function rollPool(
  formula: string | DiceExpr,
  opts: PoolOptions = {},
  rng: Rng = defaultRng
): RollResult | null {
  const expr = typeof formula === 'string' ? parseDice(formula) : formula;
  if (!expr) return null;

  let dice = rollTerms(expr, opts, rng);

  // Savage Attacker: reroll the whole pool once, keep the better total. The
  // losing pool stays in the result marked dropped, so the sheet can show
  // both. Ties keep the first roll.
  if (opts.rerollAndKeepHigher) {
    const second = rollTerms(expr, opts, rng);
    const loser = sumKept(second) > sumKept(dice) ? dice : second;
    const winner = loser === dice ? second : dice;
    for (const die of loser) die.kept = false;
    dice = [...winner, ...loser];
  }

  dice.push(...rollBonusDice(opts.bonusDice, rng));

  const total = sumKept(dice) + expr.flat;
  return {
    total,
    flat: expr.flat,
    formula: expr.source,
    dice,
    detail: formatDetail(dice, expr.flat, total)
  };
}

/**
 * Roll a d20: attack, ability check, saving throw, initiative, death save.
 * `modifier` is the flat bonus already computed by derive().
 */
export function rollD20(modifier = 0, opts: D20Options = {}, rng: Rng = defaultRng): RollResult {
  const advantage = !!opts.advantage;
  const disadvantage = !!opts.disadvantage;
  // Having both is not "roll three dice" — RAW they cancel and you roll one.
  const cancels = advantage && disadvantage;
  const mode: NonNullable<RollResult['d20']>['mode'] = cancels
    ? 'normal'
    : advantage
      ? 'advantage'
      : disadvantage
        ? 'disadvantage'
        : 'normal';

  const count = mode === 'normal' ? 1 : 2;
  const dice: RolledDie[] = [];
  for (let i = 0; i < count; i++) dice.push({ sides: 20, value: rollOne(20, rng), kept: true });

  let picked = dice[0];
  if (count === 2) {
    const [a, b] = dice;
    picked = mode === 'advantage' ? (b.value > a.value ? b : a) : b.value < a.value ? b : a;
    for (const die of dice) die.kept = die === picked;
  }

  // The natural face is captured *before* any floor. Reliable Talent turning a
  // 4 into a 10 is not a natural 10, and Silver Tongue cannot manufacture a
  // crit — the floor changes the total, never the outcome classification.
  const natural = picked.value;
  if (opts.d20Floor != null && picked.value < opts.d20Floor) {
    picked.raw = picked.value;
    picked.value = opts.d20Floor;
  }

  dice.push(...rollBonusDice(opts.bonusDice, rng));

  const total = sumKept(dice) + modifier;
  const threshold = opts.critThreshold ?? 20;
  return {
    total,
    flat: modifier,
    formula: `d20${modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ''}`,
    dice,
    detail: formatDetail(dice, modifier, total),
    d20: {
      natural,
      isCrit: natural >= threshold,
      isFumble: natural === 1,
      mode
    }
  };
}
