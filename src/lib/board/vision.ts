// Fog auto-reveal: which cells a token can see.
//
// The DM shouldn't have to hand-brush every corridor a scout walks down.
// `visibleCells` answers "standing here, what's in line of sight" and the
// encounter board ORs that into the fog mask as PC tokens move — fog only
// ever grows, so a party that has seen a room keeps it.
//
// Pure and sibling-only, per the purity guard on this directory.

import { lineOfSight, type Grid } from './geometry';
import { cellKey, inBounds, type Cell } from './types';

/** How far a token's vision reaches, in cells, when the caller doesn't say.
 *  12 cells is 60 ft on a standard board — torchlight-ish, and it keeps the
 *  Bresenham walk to a few hundred cells per move instead of the ~10k a
 *  full 100×100 sweep would cost on every token drag. */
export const DEFAULT_VISION_CELLS = 12;

/** Cells visible from `from`: inside the radius, in bounds, and with an
 *  unobstructed sight line.
 *
 *  The origin cell is always included (you can see your own square, even
 *  standing in a doorway). A sight-blocking cell is itself visible when
 *  nothing before it blocks — you can see the wall you're facing, you just
 *  can't see past it. Without that, revealing vision would leave the room's
 *  own walls fogged and the map would read as an open void.
 *
 *  Radius is Chebyshev, matching the distance model the rest of the board
 *  uses (a diagonal step is one cell). */
export function visibleCells(
  grid: Grid,
  from: Cell,
  radiusCells: number = DEFAULT_VISION_CELLS
): Cell[] {
  const r = Math.max(0, Math.floor(radiusCells));
  const out: Cell[] = [];
  if (!inBounds(grid, from)) return out;
  for (let y = from.y - r; y <= from.y + r; y++) {
    for (let x = from.x - r; x <= from.x + r; x++) {
      const c = { x, y };
      if (!inBounds(grid, c)) continue;
      if (x === from.x && y === from.y) {
        out.push(c);
        continue;
      }
      // `lineOfSight` checks the cells strictly between the endpoints, so a
      // blocker at `c` doesn't hide `c` itself — exactly the "you see the
      // wall, not what's behind it" behavior we want.
      if (lineOfSight(grid, from, c)) out.push(c);
    }
  }
  return out;
}

/** Union of what every one of `froms` can see, as a set of cellKey strings.
 *  Used for "reveal what the whole party can see" in one pass. */
export function visibleFromAny(
  grid: Grid,
  froms: Cell[],
  radiusCells: number = DEFAULT_VISION_CELLS
): Set<string> {
  const seen = new Set<string>();
  for (const from of froms) {
    for (const c of visibleCells(grid, from, radiusCells)) seen.add(cellKey(c));
  }
  return seen;
}

/** OR a visible-cell set into an existing fog bitmask, returning the new
 *  mask. Never un-reveals: a cell already revealed stays revealed even if
 *  nobody can see it now, which is how table fog works — the party
 *  remembers the room they walked through.
 *
 *  Returns null when nothing changed, so the caller can skip the PATCH
 *  (every token nudge inside an already-lit room would otherwise bump the
 *  board version and make every other tab refetch). */
export function revealVisible(
  fog: number[] | Uint16Array,
  visible: Set<string>,
  w: number,
  h: number
): number[] | null {
  const next = Array.from(fog, (v) => (v === 1 ? 1 : 0));
  let changed = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!visible.has(cellKey({ x, y }))) continue;
      const i = y * w + x;
      if (next[i] !== 1) {
        next[i] = 1;
        changed = true;
      }
    }
  }
  return changed ? next : null;
}
