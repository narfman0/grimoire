import { describe, it, expect } from 'vitest';
import { DEFAULT_VISION_CELLS, revealVisible, visibleCells, visibleFromAny } from '../vision';
import { cellKey } from '../types';
import { gridFromAscii } from './fixtures';

/** cellKey set from a visibleCells result, for readable assertions. */
const keys = (cells: Array<{ x: number; y: number }>) => new Set(cells.map(cellKey));

describe('visibleCells', () => {
  it('sees the whole room from the middle of it', () => {
    const grid = gridFromAscii(`
      ###
      #.#
      ###
    `);
    // A 1×1 room: the floor plus all eight walls around it.
    expect(visibleCells(grid, { x: 1, y: 1 }).length).toBe(9);
  });

  it('sees the wall it is facing but nothing past it', () => {
    const grid = gridFromAscii(`
      .....
      .....
      ..#..
      .....
      .....
    `);
    const seen = keys(visibleCells(grid, { x: 2, y: 0 }));
    expect(seen.has(cellKey({ x: 2, y: 2 }))).toBe(true); // the wall itself
    expect(seen.has(cellKey({ x: 2, y: 3 }))).toBe(false); // behind it
    expect(seen.has(cellKey({ x: 2, y: 4 }))).toBe(false);
  });

  it('a closed door blocks sight; an open one does not', () => {
    const closed = gridFromAscii(`
      #####
      ..D..
      #####
    `);
    const open = gridFromAscii(`
      #####
      ..d..
      #####
    `);
    const far = cellKey({ x: 4, y: 1 });
    expect(keys(visibleCells(closed, { x: 0, y: 1 })).has(far)).toBe(false);
    expect(keys(visibleCells(open, { x: 0, y: 1 })).has(far)).toBe(true);
  });

  it('always includes its own cell, even standing in a wall', () => {
    const grid = gridFromAscii(`
      ###
      ###
    `);
    expect(keys(visibleCells(grid, { x: 1, y: 1 })).has(cellKey({ x: 1, y: 1 }))).toBe(true);
  });

  it('honors the radius in Chebyshev cells', () => {
    const grid = gridFromAscii(`
      .......
      .......
      .......
      .......
      .......
    `);
    const seen = keys(visibleCells(grid, { x: 3, y: 2 }, 1));
    expect(seen.size).toBe(9); // the 3×3 block around the origin
    expect(seen.has(cellKey({ x: 5, y: 2 }))).toBe(false);
    // Radius 0 is just the origin.
    expect(visibleCells(grid, { x: 3, y: 2 }, 0)).toEqual([{ x: 3, y: 2 }]);
  });

  it('clips to the board and returns nothing from off-board', () => {
    const grid = gridFromAscii(`
      ...
      ...
    `);
    expect(visibleCells(grid, { x: 0, y: 0 }, 5).length).toBe(6);
    expect(visibleCells(grid, { x: -1, y: 0 })).toEqual([]);
    expect(visibleCells(grid, { x: 9, y: 9 })).toEqual([]);
  });

  it('defaults to a bounded radius rather than the whole board', () => {
    expect(DEFAULT_VISION_CELLS).toBeGreaterThan(0);
    expect(DEFAULT_VISION_CELLS).toBeLessThan(30);
  });
});

describe('visibleFromAny', () => {
  // The party splits around a wall; the union covers both sides.
  const grid = gridFromAscii(`
    .....
    ##.##
    .....
  `);

  it('unions what each token can see', () => {
    const solo = visibleFromAny(grid, [{ x: 0, y: 0 }], 4);
    const pair = visibleFromAny(
      grid,
      [
        { x: 0, y: 0 },
        { x: 0, y: 2 }
      ],
      4
    );
    expect(pair.size).toBeGreaterThan(solo.size);
    expect(pair.has(cellKey({ x: 4, y: 2 }))).toBe(true);
  });

  it('is empty with no tokens', () => {
    expect(visibleFromAny(grid, []).size).toBe(0);
  });
});

describe('revealVisible', () => {
  it('ORs newly visible cells into the mask', () => {
    const fog = [0, 0, 0, 0];
    const next = revealVisible(fog, new Set([cellKey({ x: 1, y: 0 })]), 2, 2);
    expect(next).toEqual([0, 1, 0, 0]);
  });

  it('never un-reveals a cell nobody can see any more', () => {
    const fog = [1, 1, 0, 0];
    const next = revealVisible(fog, new Set([cellKey({ x: 0, y: 1 })]), 2, 2);
    expect(next).toEqual([1, 1, 1, 0]);
  });

  it('returns null when nothing changed, so the caller skips the write', () => {
    const fog = [1, 1, 0, 0];
    expect(revealVisible(fog, new Set([cellKey({ x: 0, y: 0 })]), 2, 2)).toBeNull();
    expect(revealVisible(fog, new Set(), 2, 2)).toBeNull();
  });

  it('accepts the decoded Uint16Array the wire mask produces', () => {
    const fog = new Uint16Array([0, 1, 0, 0]);
    expect(revealVisible(fog, new Set([cellKey({ x: 0, y: 0 })]), 2, 2)).toEqual([1, 1, 0, 0]);
  });

  it('ignores visible cells outside the board', () => {
    expect(revealVisible([0, 0, 0, 0], new Set([cellKey({ x: 9, y: 9 })]), 2, 2)).toBeNull();
  });
});
