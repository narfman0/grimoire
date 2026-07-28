// Encounter difficulty budgeting — pure, isomorphic, no I/O.
//
// EDITION: this implements the **2014 DMG** encounter-building math (XP
// thresholds by character level, an encounter multiplier keyed on the number
// of monsters, and the party-size adjustment). The 2024 DMG replaced that
// model wholesale: it drops the multiplier and the "deadly" band, and uses
// three flat per-level budgets (low / moderate / high) that you compare
// against the *unmodified* XP sum. The two are not blendable — a 2024
// "moderate" is not a 2014 "medium" — so this module commits to 2014 and
// stamps `edition: '2014'` on every result. A 2024 mode would be a sibling
// function returning a different shape, not a flag on this one.
//
// The tables below are game-mechanical constants (numbers keyed on level /
// challenge rating). No rules prose is reproduced.

/** Difficulty bands. `trivial` is *below* the DMG's easy threshold — the
 *  book has no name for it, but the encounter page needs something to show
 *  for a lone rat vs. a level-10 party. `unknown` means we had no party to
 *  build thresholds from. */
export type DifficultyRating = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly' | 'unknown';

export interface DifficultyThresholds {
  easy: number;
  medium: number;
  hard: number;
  deadly: number;
}

/** One monster (or a stack of identical ones) in the roster. `xp` wins over
 *  `cr` when both are present — statblocks carry an explicit XP value and it
 *  is the authority; `cr` is the fallback via XP_BY_CR. */
export interface DifficultyMonsterInput {
  /** Label used in the `unrated` report. */
  name?: string;
  cr?: number | string | null;
  xp?: number | null;
  /** Number of identical copies. Defaults to 1. Non-positive values are ignored. */
  count?: number;
}

export interface EncounterDifficultyInput {
  /** Total character level per party member. Mixed-level parties are RAW:
   *  each character contributes its own per-level thresholds. */
  partyLevels: number[];
  monsters: DifficultyMonsterInput[];
}

export interface EncounterDifficultyResult {
  edition: '2014';
  partySize: number;
  /** Head count of monsters (sum of `count`), including ones we could not
   *  price — they still take turns, so they still drive the multiplier. */
  monsterCount: number;
  /** Raw XP sum before the encounter multiplier. */
  baseXp: number;
  /** Raw XP divided across the party — the "N XP/char" readout. 0-size party
   *  falls back to the raw total. */
  xpPerCharacter: number;
  /** Encounter multiplier after the party-size adjustment. */
  multiplier: number;
  /** `baseXp * multiplier`, rounded to an integer. This is the number
   *  compared against the thresholds. */
  adjustedXp: number;
  thresholds: DifficultyThresholds;
  rating: DifficultyRating;
  /** Names (or `'(unnamed)'`) of roster entries with neither a usable XP
   *  value nor a resolvable CR. They contribute 0 XP but do count toward
   *  `monsterCount`, so a non-empty list means the estimate reads *low* on
   *  XP and possibly *high* on multiplier — callers should flag it. */
  unrated: string[];
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** XP thresholds per *character*, indexed by character level 1–20:
 *  [easy, medium, hard, deadly]. (2014 DMG, "XP Thresholds by Character
 *  Level".) Index 0 is unused so the array indexes by level directly. */
const THRESHOLDS_BY_LEVEL: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0], // level 0 — unused
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
  [300, 600, 900, 1400],
  [350, 750, 1100, 1700],
  [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600],
  [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800],
  [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900],
  [2800, 5700, 8500, 12700]
];

/** XP awarded per monster by challenge rating. (2014 DMG / MM; unchanged in
 *  the 2024 MM.) CR keys are numeric — fractional CRs use their decimal
 *  value, so "1/8" resolves through parseCr() to 0.125. */
const XP_BY_CR = new Map<number, number>([
  [0, 10],
  [0.125, 25],
  [0.25, 50],
  [0.5, 100],
  [1, 200],
  [2, 450],
  [3, 700],
  [4, 1100],
  [5, 1800],
  [6, 2300],
  [7, 2900],
  [8, 3900],
  [9, 5000],
  [10, 5900],
  [11, 7200],
  [12, 8400],
  [13, 10000],
  [14, 11500],
  [15, 13000],
  [16, 15000],
  [17, 18000],
  [18, 20000],
  [19, 22000],
  [20, 25000],
  [21, 33000],
  [22, 41000],
  [23, 50000],
  [24, 62000],
  [25, 75000],
  [26, 90000],
  [27, 105000],
  [28, 120000],
  [29, 135000],
  [30, 155000]
]);

/** The multiplier ladder. The party-size adjustment moves one step along
 *  this array rather than scaling the value, which is why 0.5 exists: it is
 *  only reachable by a party of 6+ facing a single monster. */
const MULTIPLIER_TIERS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 4];

/** Index into MULTIPLIER_TIERS for a monster head count, before the
 *  party-size adjustment. Boundaries: 1 / 2 / 3–6 / 7–10 / 11–14 / 15+. */
function baseTierIndex(monsterCount: number): number {
  if (monsterCount <= 1) return 1; // x1
  if (monsterCount === 2) return 2; // x1.5
  if (monsterCount <= 6) return 3; // x2
  if (monsterCount <= 10) return 4; // x2.5
  if (monsterCount <= 14) return 5; // x3
  return 6; // x4
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Normalize a CR as written on a statblock ("1/4", "0", 5, "5") to its
 *  numeric value. Returns null for unratable input ("—", "unknown", "", a
 *  NaN, a negative). */
export function parseCr(cr: number | string | null | undefined): number | null {
  if (typeof cr === 'number') return Number.isFinite(cr) && cr >= 0 ? cr : null;
  if (typeof cr !== 'string') return null;
  const s = cr.trim();
  if (s === '') return null;
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction) {
    const denom = Number(fraction[2]);
    if (denom === 0) return null;
    return Number(fraction[1]) / denom;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** XP value for a challenge rating, or null when the CR isn't on the table
 *  (off-table CR like 3.5, or unparseable). */
export function xpForCr(cr: number | string | null | undefined): number | null {
  const n = parseCr(cr);
  if (n === null) return null;
  return XP_BY_CR.get(n) ?? null;
}

/** Per-character XP thresholds for a character level. Levels outside 1–20
 *  clamp (a level-0 or level-25 character is not a thing the tables cover). */
export function thresholdsForLevel(level: number): DifficultyThresholds {
  const clamped = Math.min(20, Math.max(1, Math.floor(level)));
  const [easy, medium, hard, deadly] = THRESHOLDS_BY_LEVEL[clamped];
  return { easy, medium, hard, deadly };
}

/** Party thresholds — the per-character thresholds summed across the party.
 *  An empty party yields all-zero thresholds; callers should treat that as
 *  "no budget to compare against" rather than "everything is deadly". */
export function partyThresholds(partyLevels: number[]): DifficultyThresholds {
  const total: DifficultyThresholds = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const level of partyLevels) {
    if (!Number.isFinite(level) || level <= 0) continue;
    const t = thresholdsForLevel(level);
    total.easy += t.easy;
    total.medium += t.medium;
    total.hard += t.hard;
    total.deadly += t.deadly;
  }
  return total;
}

/** Encounter multiplier for a monster head count, adjusted for party size:
 *  a party smaller than 3 steps one tier *up*, a party larger than 5 steps
 *  one tier *down*. An empty roster is x1 (nothing to multiply); an unknown
 *  party size (0) takes no adjustment. */
export function encounterMultiplier(monsterCount: number, partySize: number): number {
  if (monsterCount <= 0) return 1;
  let index = baseTierIndex(monsterCount);
  if (partySize > 0 && partySize < 3) index += 1;
  else if (partySize > 5) index -= 1;
  index = Math.min(MULTIPLIER_TIERS.length - 1, Math.max(0, index));
  return MULTIPLIER_TIERS[index];
}

/** Band an adjusted XP total against a set of party thresholds. */
export function rateAdjustedXp(
  adjustedXp: number,
  thresholds: DifficultyThresholds,
  partySize: number
): DifficultyRating {
  if (partySize <= 0) return 'unknown';
  if (adjustedXp >= thresholds.deadly) return 'deadly';
  if (adjustedXp >= thresholds.hard) return 'hard';
  if (adjustedXp >= thresholds.medium) return 'medium';
  if (adjustedXp >= thresholds.easy) return 'easy';
  return 'trivial';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Rate an encounter against its party.
 *
 * Edge cases, all deliberate:
 * - **Empty party** → zeroed thresholds and `rating: 'unknown'`. We refuse
 *   to band an encounter with nothing to band it against.
 * - **Empty roster** → `baseXp` 0, multiplier 1, `rating: 'trivial'` (or
 *   `'unknown'` if the party is also empty).
 * - **Monster with neither XP nor a table CR** → contributes 0 XP, still
 *   counts toward `monsterCount`, and is listed in `unrated`.
 * - **Mixed-level party** → thresholds are summed per character at that
 *   character's own level, which is what the DMG prescribes.
 */
export function encounterDifficulty(input: EncounterDifficultyInput): EncounterDifficultyResult {
  const partyLevels = (input.partyLevels ?? []).filter((l) => Number.isFinite(l) && l > 0);
  const partySize = partyLevels.length;

  let baseXp = 0;
  let monsterCount = 0;
  const unrated: string[] = [];

  for (const m of input.monsters ?? []) {
    const count = m.count == null ? 1 : Math.floor(m.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    monsterCount += count;

    const explicitXp =
      typeof m.xp === 'number' && Number.isFinite(m.xp) && m.xp >= 0 ? m.xp : null;
    const xp = explicitXp ?? xpForCr(m.cr);
    if (xp === null) {
      unrated.push(m.name && m.name.trim() !== '' ? m.name : '(unnamed)');
      continue;
    }
    baseXp += xp * count;
  }

  const multiplier = encounterMultiplier(monsterCount, partySize);
  const adjustedXp = Math.round(baseXp * multiplier);
  const thresholds = partyThresholds(partyLevels);

  return {
    edition: '2014',
    partySize,
    monsterCount,
    baseXp,
    xpPerCharacter: partySize > 0 ? Math.round(baseXp / partySize) : baseXp,
    multiplier,
    adjustedXp,
    thresholds,
    rating: rateAdjustedXp(adjustedXp, thresholds, partySize),
    unrated
  };
}
