// Theater-of-mind fallback for the NPC turn optimizer.
//
// Without a painted board there are no positions, so `suggestTurn` — which
// ranks action × target × destination — had nothing to stand on and mapless
// tables got no suggestions at all. This module fabricates a small, fixed
// tableau that encodes the standard theater-of-mind assumptions: the two
// sides face each other a short move apart, each side is loosely clustered,
// and everyone is reachable. The optimizer then answers the question a
// mapless DM is actually asking — *which action at which target* — and the
// caller strips the fictional movement from the result.
//
// The tableau (5 ft cells, all open floor):
//
//   column 1: the actor's allies      column 3: their enemies
//   (0, mid): the actor
//
// so the actor stands 15 ft from the enemy line — one short move closes to
// melee, ranged attacks work from the spot, and an AoE centered on the
// enemy column catches its neighbours (clustered, as fiction usually has
// them) while a big-enough template clips the ally column and pays the
// friendly-fire penalty. Every placement is deterministic (sorted by id) so
// suggestions don't reshuffle between polls.
//
// This replaces the earlier `impliedBoard()` 30-ft-band strip, which no
// consumer ever adopted for a reason: with 30 ft between any two cells,
// melee reach could never connect and the optimizer returned nothing.
//
// Pure and sibling-only, per the purity guard on this directory.

import type { Grid } from './geometry';
import { tileBySlug } from './tileset';
import type { Cell } from './types';

export interface ImpliedCombatant {
  id: string;
  /** 'pc' vs anything else, same convention as the board tokens. */
  team: string;
}

export interface ImpliedSetup {
  grid: Grid;
  /** Fabricated cell per combatant id, actor included. */
  cells: Map<string, Cell>;
}

const FLOOR_ID = tileBySlug('floor')?.id ?? 1;
const GRID_W = 8;

/** Fabricate the tableau for one actor's turn. `others` may include the
 *  actor's row; it is placed at the head of its own column regardless. */
export function impliedSetup(
  actorId: string,
  actorTeam: string,
  others: readonly ImpliedCombatant[]
): ImpliedSetup {
  const rest = others.filter((o) => o.id !== actorId);
  const allies = rest.filter((o) => o.team === actorTeam).sort(byId);
  const enemies = rest.filter((o) => o.team !== actorTeam).sort(byId);

  // Tall enough that the longer column fits spreading out from the middle.
  const longest = Math.max(allies.length, enemies.length);
  const h = Math.max(7, longest * 2 + 1);
  const mid = Math.floor(h / 2);

  const cells = new Map<string, Cell>();
  cells.set(actorId, { x: 0, y: mid });
  allies.forEach((a, i) => cells.set(a.id, { x: 1, y: spread(mid, i + 1, h) }));
  enemies.forEach((e, i) => cells.set(e.id, { x: 3, y: spread(mid, i, h) }));

  return {
    grid: { w: GRID_W, h, cellFt: 5, tiles: new Uint16Array(GRID_W * h).fill(FLOOR_ID) },
    cells
  };
}

/** Rows fanning out from the middle: mid, mid−1, mid+1, mid−2, … clamped to
 *  the grid. Keeps each column packed around its centre so templates read
 *  as "the cluster", not a picket line. */
function spread(mid: number, i: number, h: number): number {
  const offset = Math.ceil(i / 2) * (i % 2 === 1 ? -1 : 1);
  return Math.min(h - 1, Math.max(0, mid + offset));
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);

/** Strip the fabricated movement from a ranked plan before it reaches the
 *  UI or a stored TurnPlan: on a board that doesn't exist, "move to (2, 3)"
 *  is noise at best and a bogus token write at worst. The action, targets
 *  and score are the real product. */
export function stripImpliedMovement<
  T extends { moveTo: Cell | null; path: Cell[] | null; oaRisked: number; rationale: string }
>(plan: T): T {
  return {
    ...plan,
    moveTo: null,
    path: null,
    oaRisked: 0,
    rationale: plan.rationale
      .replace(/^(?:move to|stay at) \(\d+, \d+\)(?:; )?/, '')
      .replace(/(?:; )?\d+ OA risked$/, '')
  };
}
