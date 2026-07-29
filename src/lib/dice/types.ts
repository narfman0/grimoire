// Dice evaluator types. This module is pure and isomorphic, and lives
// *outside* src/lib/rules/ on purpose: derive() must be deterministic, and
// purity.test.ts now enforces both that it stays free of RNG and that it never
// imports anything from here.
//
// Randomness enters only as an injected `Rng`. Every interesting behaviour
// (advantage, floors, rerolls, crit dice, maximize, keep-highest) is pure
// logic on top of that, so the whole module is testable with a scripted RNG
// and exact expected values rather than statistical assertions.

/** A random source over [0, 1). Injected by the caller so rolls are
 *  reproducible in tests. */
export type Rng = () => number;

/** One `NdS` pool, optionally keeping the best/worst few (`4d6kh3`). Dice
 *  terms are always additive — `1d8-1d4` is rejected at parse time, since it
 *  has no 5e use and complicates every downstream sum. Flat modifiers may be
 *  negative. */
export interface DiceTerm {
  count: number;
  sides: number;
  keep?: { count: number; from: 'highest' | 'lowest' };
}

/** A parsed formula: some dice pools plus a signed constant. */
export interface DiceExpr {
  terms: DiceTerm[];
  /** Sum of every constant in the formula, signed. */
  flat: number;
  /** The formula as authored, for display. */
  source: string;
}

/** One physical die in a result.
 *
 *  `kept: false` means the die was rolled but doesn't count (the low die of an
 *  advantage pair, a `kh3` castoff, the losing pool of a Savage Attacker
 *  reroll). Dropped dice are retained rather than discarded so the UI can show
 *  a player *why* a number is what it is. */
export interface RolledDie {
  sides: number;
  /** The value that contributes to the total. */
  value: number;
  kept: boolean;
  /** The number actually rolled, present only when something changed it —
   *  a Great Weapon Fighting floor, Reliable Talent, etc. */
  raw?: number;
  /** Where the die came from, when it wasn't in the base formula. */
  origin?: 'crit' | 'bonus';
  /** Set when the die was taken at its maximum instead of rolled. */
  maximized?: boolean;
}

export interface RollResult {
  total: number;
  /** The constant part, already included in `total`. */
  flat: number;
  /** Formula as authored (or synthesized, for d20 rolls). */
  formula: string;
  dice: RolledDie[];
  /** Human-readable breakdown, e.g. `[18, (7)] + 5 = 23`. */
  detail: string;
  /** Present on d20 rolls only. */
  d20?: {
    /** The die face on the kept d20, *before* any floor is applied.
     *  Crits and fumbles key off this: Reliable Talent turning a 4 into a 10
     *  is not a natural 10, and Silver Tongue can't manufacture a crit. */
    natural: number;
    isCrit: boolean;
    isFumble: boolean;
    mode: 'normal' | 'advantage' | 'disadvantage';
  };
}

/** Options for a d20 roll — attack, check, save, initiative, death save. */
export interface D20Options {
  /** Both set cancel to a single straight roll, per RAW. */
  advantage?: boolean;
  disadvantage?: boolean;
  /** Extra dice added to the result: Bless (`1d4`), Bardic Inspiration. */
  bonusDice?: string[];
  /** Treat a die face below this as this value (Reliable Talent, Silver
   *  Tongue). Applied to the die that survives the advantage pick. */
  d20Floor?: number;
  /** Face at or above which the roll crits. Default 20; Champion's Improved
   *  Critical is 19, Superior Critical 18. */
  critThreshold?: number;
}

/** Options for a dice pool — damage, healing, hit dice, free-form formulas. */
export interface PoolOptions {
  /** Minimum value for every die (Great Weapon Fighting's reroll of 1s and
   *  2s is modeled as a floor of 3). Applied per die, not to the total. */
  dieMin?: number;
  /** Every die yields its maximum instead of being rolled (Overchannel,
   *  Supreme Healing, potion of maximum power). */
  maximize?: boolean;
  /** Roll the whole pool twice and keep the better total (Savage Attacker).
   *  One reroll of the set, not per die. */
  rerollAndKeepHigher?: boolean;
  /** Double the dice — a crit, or Death Strike. Doubles dice only, never the
   *  flat modifier. */
  doubleDice?: boolean;
  /** Extra dice of the first term's size, added *after* any doubling so a
   *  crit doesn't double them too (Savage Attacks). */
  extraDice?: number;
  /** Extra dice added to the result, as formulas. */
  bonusDice?: string[];
}
