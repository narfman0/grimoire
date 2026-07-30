// Pure board geometry — the primitives everything else consumes: movement
// (Dijkstra with difficult terrain), line of sight, cover, AoE templates,
// threatened cells, and the mapless fallback. Deterministic, no I/O, no
// framework imports (pinned by the purity guard alongside src/lib/rules).
//
// Distance model: 5e standard — every diagonal costs 5 ft, so distance is
// Chebyshev × cellFt and AoE "spheres" are squares on the grid. Consistent
// everywhere (movement, range, templates) beats prettier circles.

import { decodeRuns } from './rle';
import { tileById, type TileDef } from './tileset';
import { cellKey, inBounds, type Board, type Cell } from './types';

/** A Board with its tile string decoded once — pass this to the primitives
 *  so a planning overlay doesn't re-decode per frame. */
export interface Grid {
  w: number;
  h: number;
  cellFt: number;
  tiles: Uint16Array;
}

export function decodeBoard(board: Board): Grid {
  return {
    w: board.w,
    h: board.h,
    cellFt: board.cellFt,
    tiles: decodeRuns(board.tiles, board.w * board.h)
  };
}

export function tileAt(grid: Grid, c: Cell): TileDef {
  return tileById(grid.tiles[c.y * grid.w + c.x]);
}

/** 5e standard distance: every diagonal is one cell (Chebyshev). */
export function distanceFt(grid: Pick<Grid, 'cellFt'>, a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * grid.cellFt;
}

export function inRangeFt(grid: Pick<Grid, 'cellFt'>, a: Cell, b: Cell, rangeFt: number): boolean {
  return distanceFt(grid, a, b) <= rangeFt;
}

/** The cells a token of `sizeCells` anchored at `anchor` (top-left) stands on. */
export function footprintCells(anchor: Cell, sizeCells: number): Cell[] {
  const size = Math.max(1, Math.floor(sizeCells));
  const out: Cell[] = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) out.push({ x: anchor.x + dx, y: anchor.y + dy });
  }
  return out;
}

export interface OccupiedCells {
  /** Cells held by allies of the mover: passable but cost double (2024
   *  rules: another creature's space is difficult terrain) and cannot be a
   *  destination. */
  allies?: Cell[];
  /** Cells held by enemies: impassable outright. */
  enemies?: Cell[];
}

export interface ReachableResult {
  /** Movement cost in feet to each reachable cell, keyed by cellKey. The
   *  start cell is present at cost 0. Cells that can be crossed but not
   *  occupied (ally squares) are excluded. */
  costFt: Map<string, number>;
  /** Predecessor map over every *visited* cell (including pass-through ally
   *  squares) for path reconstruction; the start maps to null. */
  prev: Map<string, string | null>;
}

/** Dijkstra flood from `from` with `speedFt` of movement. Difficult terrain
 *  doubles the cost of entering a cell; `blocksMove` tiles and enemy cells
 *  never enter the frontier; ally cells cost double and can be crossed but
 *  not ended on. Diagonals cost the same as orthogonals (5e standard). */
export function reachableCells(
  grid: Grid,
  from: Cell,
  speedFt: number,
  occupied: OccupiedCells = {}
): ReachableResult {
  const allies = new Set((occupied.allies ?? []).map(cellKey));
  const enemies = new Set((occupied.enemies ?? []).map(cellKey));
  const startKey = cellKey(from);
  allies.delete(startKey);
  enemies.delete(startKey);

  const best = new Map<string, number>();
  const prev = new Map<string, string | null>();
  best.set(startKey, 0);
  prev.set(startKey, null);

  // Plain array as a priority queue: boards cap at 100×100 and edge costs
  // take two values, so an O(n log n) heap buys nothing measurable.
  const frontier: Array<{ cell: Cell; cost: number }> = [{ cell: from, cost: 0 }];
  while (frontier.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (frontier[i].cost < frontier[bestIdx].cost) bestIdx = i;
    }
    const { cell, cost } = frontier.splice(bestIdx, 1)[0];
    const key = cellKey(cell);
    if (cost > (best.get(key) ?? Infinity)) continue;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const next = { x: cell.x + dx, y: cell.y + dy };
        if (!inBounds(grid, next)) continue;
        const nextKey = cellKey(next);
        if (enemies.has(nextKey)) continue;
        const tile = tileAt(grid, next);
        if (tile.blocksMove) continue;
        const stepFt = grid.cellFt * (tile.difficult || allies.has(nextKey) ? 2 : 1);
        const nextCost = cost + stepFt;
        if (nextCost > speedFt) continue;
        if (nextCost >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, nextCost);
        prev.set(nextKey, key);
        frontier.push({ cell: next, cost: nextCost });
      }
    }
  }

  const costFt = new Map<string, number>();
  for (const [key, cost] of best) {
    if (allies.has(key)) continue; // crossable, not endable
    costFt.set(key, cost);
  }
  return { costFt, prev };
}

/** Reconstruct the cheapest path to `dest` from a `reachableCells` result.
 *  Returns the cell list start→dest inclusive, or null when unreachable. */
export function pathTo(result: ReachableResult, dest: Cell): Cell[] | null {
  const destKey = cellKey(dest);
  if (!result.prev.has(destKey)) return null;
  const out: Cell[] = [];
  let key: string | null = destKey;
  while (key !== null) {
    const [x, y] = key.split(',').map(Number);
    out.push({ x, y });
    key = result.prev.get(key) ?? null;
  }
  return out.reverse();
}

/** Cells strictly between a and b on the sight line (Bresenham), endpoints
 *  excluded. */
function betweenCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === b.x && y === b.y) break;
    out.push({ x, y });
  }
  return out;
}

export function lineOfSight(grid: Grid, a: Cell, b: Cell): boolean {
  return betweenCells(a, b).every((c) => !tileAt(grid, c).blocksSight);
}

export type Cover = 'none' | 'half' | 'three-quarters' | 'full';

const COVER_RANK: Record<Cover, number> = { none: 0, half: 1, 'three-quarters': 2, full: 3 };

/** Cover the target has against the attacker, from intervening tiles on the
 *  sight line: any sight blocker → full; otherwise the best cover value of
 *  tiles crossed. Endpoints don't count (standing in foliage is the DM's
 *  call, not the geometry's). */
export function coverBetween(grid: Grid, attacker: Cell, target: Cell): Cover {
  let best: Cover = 'none';
  for (const c of betweenCells(attacker, target)) {
    const tile = tileAt(grid, c);
    if (tile.blocksSight) return 'full';
    if (tile.cover && COVER_RANK[tile.cover] > COVER_RANK[best]) best = tile.cover;
  }
  return best;
}

export type AoeShape = 'sphere' | 'cone' | 'line' | 'cube';

/** Cells covered by an AoE template. `dir` (any cell in the intended
 *  direction) is required for cone/line and orients cube; sphere ignores it.
 *  Cells without line of sight from the origin are excluded — total cover
 *  blocks area effects. The origin cell itself is included for sphere/cube,
 *  excluded for cone/line (they project *from* the caster). */
export function aoeCells(
  grid: Grid,
  origin: Cell,
  shape: AoeShape,
  sizeFt: number,
  dir?: Cell
): Cell[] {
  const sizeCellsFloat = sizeFt / grid.cellFt;
  const out: Cell[] = [];
  const push = (c: Cell) => {
    if (!inBounds(grid, c)) return;
    if (!(c.x === origin.x && c.y === origin.y) && !lineOfSight(grid, origin, c)) return;
    out.push(c);
  };

  if (shape === 'sphere') {
    const r = Math.floor(sizeCellsFloat);
    for (let y = origin.y - r; y <= origin.y + r; y++) {
      for (let x = origin.x - r; x <= origin.x + r; x++) push({ x, y });
    }
    return out;
  }

  if (shape === 'cube') {
    const n = Math.max(1, Math.round(sizeCellsFloat));
    const s = dirSign(origin, dir);
    let x0: number, y0: number;
    if (s.x === 0 && s.y === 0) {
      x0 = origin.x - Math.floor((n - 1) / 2);
      y0 = origin.y - Math.floor((n - 1) / 2);
    } else {
      // Anchored at the origin's facing edge: extend dir-ward, centered on
      // the perpendicular axis for cardinal directions.
      x0 = s.x !== 0 ? origin.x + (s.x === 1 ? 1 : -n) : origin.x - Math.floor((n - 1) / 2);
      y0 = s.y !== 0 ? origin.y + (s.y === 1 ? 1 : -n) : origin.y - Math.floor((n - 1) / 2);
    }
    for (let y = y0; y < y0 + n; y++) {
      for (let x = x0; x < x0 + n; x++) push({ x, y });
    }
    return out;
  }

  // cone / line: project from the origin along the normalized direction.
  if (!dir || (dir.x === origin.x && dir.y === origin.y)) return out;
  const vx = dir.x - origin.x;
  const vy = dir.y - origin.y;
  const vlen = Math.hypot(vx, vy);
  const ux = vx / vlen;
  const uy = vy / vlen;
  const maxCells = Math.ceil(sizeCellsFloat);
  const EPS = 1e-9;
  for (let y = origin.y - maxCells; y <= origin.y + maxCells; y++) {
    for (let x = origin.x - maxCells; x <= origin.x + maxCells; x++) {
      if (x === origin.x && y === origin.y) continue;
      const rx = x - origin.x;
      const ry = y - origin.y;
      const proj = rx * ux + ry * uy;
      const perp = Math.abs(rx * uy - ry * ux);
      if (proj <= 0 || proj > sizeCellsFloat + EPS) continue;
      const halfWidth = shape === 'line' ? 0.5 : proj / 2;
      if (perp <= halfWidth + EPS) push({ x, y });
    }
  }
  return out;
}

function dirSign(origin: Cell, dir?: Cell): { x: number; y: number } {
  if (!dir) return { x: 0, y: 0 };
  return { x: Math.sign(dir.x - origin.x), y: Math.sign(dir.y - origin.y) };
}

export interface ThreatSource {
  cell: Cell;
  team: string;
  /** Melee reach in feet; defaults to 5. */
  reachFt?: number;
  sizeCells?: number;
}

/** Cells threatened by enemies of `byTeam` — the union of every hostile
 *  melee-reach envelope. A path for a `byTeam` creature that crosses these
 *  cells risks opportunity attacks; the optimizer counts the overlap. */
export function threatenedCells(
  grid: Grid,
  participants: ThreatSource[],
  byTeam: string
): Set<string> {
  const out = new Set<string>();
  for (const p of participants) {
    if (p.team === byTeam) continue;
    const reachCells = Math.max(1, Math.round((p.reachFt ?? 5) / grid.cellFt));
    for (const foot of footprintCells(p.cell, p.sizeCells ?? 1)) {
      for (let dy = -reachCells; dy <= reachCells; dy++) {
        for (let dx = -reachCells; dx <= reachCells; dx++) {
          const c = { x: foot.x + dx, y: foot.y + dy };
          if (inBounds(grid, c)) out.add(cellKey(c));
        }
      }
    }
  }
  return out;
}

