// Area-of-effect targeting and cover semantics, on top of the raw
// geometry in ./geometry.
//
// `aoeCells` and `coverBetween` answer questions about *cells*; combat
// asks about *creatures*. This module bridges the two: which tokens a
// locked template actually catches (footprint overlap, not just the
// token's anchor cell — a gargantuan dragon clipped by the edge of a
// fireball is caught), and what a cover verdict means at the table.
//
// Pure and sibling-only, per the purity guard on this directory.

import { footprintCells, type Cover } from './geometry';
import { cellKey, type Cell } from './types';

/** The AoE presets the encounter board offers. Sizes are the printed 5e
 *  values for the spells DMs reach for most; the panel also allows a
 *  free ft entry. */
export interface AoePreset {
  shape: 'sphere' | 'cone' | 'line' | 'cube';
  sizeFt: number;
  label: string;
}

export const AOE_PRESETS: readonly AoePreset[] = [
  { shape: 'sphere', sizeFt: 20, label: 'Fireball (20 ft radius)' },
  { shape: 'sphere', sizeFt: 10, label: 'Shatter (10 ft radius)' },
  { shape: 'cone', sizeFt: 15, label: 'Burning Hands (15 ft cone)' },
  { shape: 'cone', sizeFt: 60, label: 'Dragon breath (60 ft cone)' },
  { shape: 'line', sizeFt: 100, label: 'Lightning Bolt (100 ft line)' },
  { shape: 'line', sizeFt: 30, label: 'Breath line (30 ft)' },
  { shape: 'cube', sizeFt: 15, label: 'Thunderwave (15 ft cube)' }
] as const;

/** Minimum token shape the overlap test needs. */
export interface PlacedToken {
  id: string;
  x: number;
  y: number;
  sizeCells: number;
}

/** Ids of the tokens whose footprint intersects `cells`, in the order the
 *  tokens were given (so the caller's initiative/roster order survives).
 *
 *  Footprint, not anchor cell: a Huge creature occupying a 3×3 block is
 *  caught by a template that only clips one of its squares, which is how
 *  the table adjudicates it. */
export function tokensInCells(cells: Iterable<Cell>, tokens: PlacedToken[]): string[] {
  const covered = new Set<string>();
  for (const c of cells) covered.add(cellKey(c));
  const hit: string[] = [];
  for (const t of tokens) {
    const foot = footprintCells({ x: t.x, y: t.y }, t.sizeCells);
    if (foot.some((c) => covered.has(cellKey(c)))) hit.push(t.id);
  }
  return hit;
}

/** What a cover verdict is worth mechanically. 5e gives cover as an AC
 *  *and* Dex-save bonus; full cover can't be targeted at all. */
export interface CoverEffect {
  /** AC / Dex-save bonus. 0 for none; full cover has no number — it's a
   *  legality question, not a modifier. */
  bonus: number;
  /** Table-facing summary, e.g. `'half cover — +2 AC'`. Empty for none. */
  label: string;
  /** True when the target can't be hit by a targeted attack at all. */
  untargetable: boolean;
}

const COVER_EFFECTS: Record<Cover, CoverEffect> = {
  none: { bonus: 0, label: '', untargetable: false },
  half: { bonus: 2, label: 'half cover — +2 AC', untargetable: false },
  'three-quarters': {
    bonus: 5,
    label: 'three-quarters cover — +5 AC',
    untargetable: false
  },
  full: { bonus: 0, label: 'full cover — cannot be targeted', untargetable: true }
};

export function coverEffect(cover: Cover): CoverEffect {
  return COVER_EFFECTS[cover];
}
