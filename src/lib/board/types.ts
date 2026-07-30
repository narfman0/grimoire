// Board contract shared by the painter UI, the REST API, and the geometry
// engine. Pure types — the agreed shapes from docs/ws3-boards-plan.md §A;
// land here first so schema (§B), painter (§C), and geometry (§A) can build
// against them in parallel.

/** Hard cap on board dimensions, in cells. */
export const BOARD_MAX_DIM = 100;

/** 5e standard cell size in feet. */
export const DEFAULT_CELL_FT = 5;

export interface Board {
  /** Width/height in cells; each within [1, BOARD_MAX_DIM]. */
  w: number;
  h: number;
  /** Feet per cell edge (default DEFAULT_CELL_FT). */
  cellFt: number;
  /** RLE-encoded tile ids, row-major (see ./rle). */
  tiles: string;
  /** Optional image url rendered under the tile layer. */
  background?: string | null;
}

/** A cell coordinate. Origin top-left, x → right, y → down. */
export interface Cell {
  x: number;
  y: number;
}

export function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

export function inBounds(board: { w: number; h: number }, c: Cell): boolean {
  return Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < board.w && c.y < board.h;
}
