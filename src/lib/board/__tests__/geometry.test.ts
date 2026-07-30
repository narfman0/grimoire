import { describe, expect, it } from 'vitest';
import {
  aoeCells,
  coverBetween,
  decodeBoard,
  distanceFt,
  footprintCells,
  inRangeFt,
  lineOfSight,
  pathTo,
  reachableCells,
  threatenedCells
} from '../geometry';
import { encodeRuns } from '../rle';
import { cellKey, type Cell } from '../types';
import { gridFromAscii } from './fixtures';

const keys = (cells: Cell[]) => new Set(cells.map(cellKey));

describe('decodeBoard', () => {
  it('decodes the RLE tile string once', () => {
    const grid = decodeBoard({ w: 3, h: 2, cellFt: 5, tiles: encodeRuns([1, 1, 2, 2, 0, 1]) });
    expect(Array.from(grid.tiles)).toEqual([1, 1, 2, 2, 0, 1]);
  });

  it('throws on a tile string that does not match w×h', () => {
    expect(() => decodeBoard({ w: 3, h: 2, cellFt: 5, tiles: '1x5' })).toThrow(/expected 6/);
  });
});

describe('distanceFt / inRangeFt', () => {
  const grid = gridFromAscii(`
    .....
    .....
    .....
  `);

  it('is Chebyshev × cellFt (every diagonal 5 ft)', () => {
    expect(distanceFt(grid, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(distanceFt(grid, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(15);
    expect(distanceFt(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(10);
    expect(distanceFt(grid, { x: 4, y: 2 }, { x: 0, y: 1 })).toBe(20);
  });

  it('inRangeFt is inclusive at the boundary', () => {
    expect(inRangeFt(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, 5)).toBe(true);
    expect(inRangeFt(grid, { x: 0, y: 0 }, { x: 2, y: 0 }, 5)).toBe(false);
  });
});

describe('reachableCells', () => {
  it('floods an open room at Chebyshev cost', () => {
    const grid = gridFromAscii(`
      .....
      .....
      .....
      .....
      .....
    `);
    const { costFt } = reachableCells(grid, { x: 2, y: 2 }, 10);
    expect(costFt.size).toBe(25);
    expect(costFt.get('2,2')).toBe(0);
    expect(costFt.get('0,0')).toBe(10);
    expect(costFt.get('4,3')).toBe(10);
  });

  it('doubles the cost of entering difficult terrain', () => {
    const grid = gridFromAscii(`.*.`);
    const short = reachableCells(grid, { x: 0, y: 0 }, 10);
    expect(short.costFt.get('1,0')).toBe(10);
    expect(short.costFt.has('2,0')).toBe(false);
    const long = reachableCells(grid, { x: 0, y: 0 }, 15);
    expect(long.costFt.get('2,0')).toBe(15);
  });

  it('paths around a wall through a corridor', () => {
    const grid = gridFromAscii(`
      ..#..
      ..#..
      .....
    `);
    const blocked = reachableCells(grid, { x: 0, y: 0 }, 15);
    expect(blocked.costFt.has('4,0')).toBe(false);
    const around = reachableCells(grid, { x: 0, y: 0 }, 20);
    expect(around.costFt.get('4,0')).toBe(20);
    expect(around.costFt.has('2,0')).toBe(false); // the wall itself never enters
  });

  it('never reaches a walled-off island', () => {
    const grid = gridFromAscii(`
      ..#..
      ..#..
      ..#..
    `);
    const { costFt } = reachableCells(grid, { x: 0, y: 1 }, 100);
    for (const key of costFt.keys()) {
      expect(Number(key.split(',')[0])).toBeLessThan(2);
    }
  });

  it('closed doors block; open doors pass', () => {
    const closed = gridFromAscii(`
      ...
      #D#
      ...
    `);
    expect(reachableCells(closed, { x: 1, y: 0 }, 100).costFt.has('1,2')).toBe(false);
    const open = gridFromAscii(`
      ...
      #d#
      ...
    `);
    expect(reachableCells(open, { x: 1, y: 0 }, 100).costFt.get('1,2')).toBe(10);
  });

  it('enemies block movement outright in a corridor', () => {
    const grid = gridFromAscii(`.....`);
    const { costFt } = reachableCells(grid, { x: 0, y: 0 }, 30, {
      enemies: [{ x: 2, y: 0 }]
    });
    expect(costFt.get('1,0')).toBe(5);
    expect(costFt.has('2,0')).toBe(false);
    expect(costFt.has('3,0')).toBe(false);
  });

  it('allies cost double to cross and cannot be a destination', () => {
    const grid = gridFromAscii(`.....`);
    const { costFt } = reachableCells(grid, { x: 0, y: 0 }, 30, {
      allies: [{ x: 2, y: 0 }]
    });
    expect(costFt.has('2,0')).toBe(false);
    expect(costFt.get('3,0')).toBe(20); // 5 + 10 (ally square) + 5
    expect(costFt.get('4,0')).toBe(25);
  });

  it('reconstructs the cheapest path', () => {
    const grid = gridFromAscii(`
      ...
      ...
      ...
    `);
    const result = reachableCells(grid, { x: 0, y: 0 }, 30);
    expect(pathTo(result, { x: 2, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 }
    ]);
    expect(pathTo(result, { x: 2, y: 0 })).toHaveLength(3);
  });

  it('pathTo returns null for unreachable cells', () => {
    const grid = gridFromAscii(`.#.`);
    const result = reachableCells(grid, { x: 0, y: 0 }, 100);
    expect(pathTo(result, { x: 2, y: 0 })).toBeNull();
  });
});

describe('lineOfSight', () => {
  const grid = gridFromAscii(`
    .....
    ..#..
    ..K..
  `);

  it('sees along a clear row', () => {
    expect(lineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('is blocked by a wall between the endpoints', () => {
    expect(lineOfSight(grid, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
  });

  it('is blocked by darkness (sight, not movement)', () => {
    expect(lineOfSight(grid, { x: 0, y: 2 }, { x: 4, y: 2 })).toBe(false);
    expect(reachableCells(grid, { x: 0, y: 2 }, 100).costFt.has('4,2')).toBe(true);
  });

  it('is blocked diagonally through a corner blocker', () => {
    const diag = gridFromAscii(`
      ...
      .#.
      ...
    `);
    expect(lineOfSight(diag, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(lineOfSight(diag, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(false);
    // A graze along the blocker's corner counts as blocked (Bresenham steps
    // through the cell) — conservative and deterministic.
    expect(lineOfSight(diag, { x: 0, y: 0 }, { x: 2, y: 1 })).toBe(false);
    expect(lineOfSight(diag, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(lineOfSight(diag, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });

  it('endpoints never block themselves', () => {
    const inDark = gridFromAscii(`K.K`);
    expect(lineOfSight(inDark, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(lineOfSight(inDark, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });
});

describe('coverBetween', () => {
  it('reports half cover from intervening furniture', () => {
    const grid = gridFromAscii(`..f..`);
    expect(coverBetween(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe('half');
  });

  it('reports full cover through a sight blocker', () => {
    const grid = gridFromAscii(`..#..`);
    expect(coverBetween(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe('full');
  });

  it('does not count the endpoints themselves', () => {
    const grid = gridFromAscii(`..f`);
    expect(coverBetween(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe('none');
  });

  it('reports none across open floor', () => {
    const grid = gridFromAscii(`.....`);
    expect(coverBetween(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe('none');
  });

  it('diagonal lines pick up cover they cross', () => {
    const grid = gridFromAscii(`
      ...
      .F.
      ...
    `);
    expect(coverBetween(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe('half');
  });
});

describe('aoeCells', () => {
  const open = gridFromAscii(`
    .......
    .......
    .......
    .......
    .......
    .......
    .......
  `);

  it('sphere is the Chebyshev disc, origin included', () => {
    const cells = aoeCells(open, { x: 3, y: 3 }, 'sphere', 10);
    expect(cells).toHaveLength(25);
    expect(keys(cells).has('3,3')).toBe(true);
    expect(keys(cells).has('1,1')).toBe(true);
    expect(keys(cells).has('0,3')).toBe(false);
  });

  it('sphere clips at the board edge', () => {
    const cells = aoeCells(open, { x: 0, y: 0 }, 'sphere', 10);
    expect(cells).toHaveLength(9);
  });

  it('sphere excludes cells behind full sight blockers', () => {
    const grid = gridFromAscii(`
      .......
      .......
      .......
      .#.....
      .......
    `);
    const cells = keys(aoeCells(grid, { x: 0, y: 3 }, 'sphere', 10));
    expect(cells.has('2,3')).toBe(false); // straight through the wall
    expect(cells.has('1,3')).toBe(true); // the wall cell itself is caught
    expect(cells.has('2,2')).toBe(true); // spills around the corner
  });

  it('cone east covers the widening triangle', () => {
    const cells = keys(aoeCells(open, { x: 0, y: 3 }, 'cone', 15, { x: 1, y: 3 }));
    expect(cells).toEqual(
      keys([
        { x: 1, y: 3 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 3, y: 4 }
      ])
    );
  });

  it('cone against a wall stops at the wall but spills diagonally', () => {
    const grid = gridFromAscii(`
      .......
      .......
      .......
      .#.....
      .......
      .......
      .......
    `);
    const cells = keys(aoeCells(grid, { x: 0, y: 3 }, 'cone', 15, { x: 1, y: 3 }));
    expect(cells.has('2,3')).toBe(false);
    expect(cells.has('3,3')).toBe(false);
    expect(cells.has('2,2')).toBe(true);
    expect(cells.has('2,4')).toBe(true);
  });

  it('cone pointed diagonally hugs the diagonal', () => {
    const cells = keys(aoeCells(open, { x: 0, y: 0 }, 'cone', 15, { x: 1, y: 1 }));
    expect(cells.has('1,1')).toBe(true);
    expect(cells.has('2,2')).toBe(true);
    expect(cells.has('2,1')).toBe(true);
    expect(cells.has('1,2')).toBe(true);
    expect(cells.has('3,0')).toBe(false);
  });

  it('line east is one cell wide', () => {
    const cells = aoeCells(open, { x: 0, y: 3 }, 'line', 20, { x: 1, y: 3 });
    expect(keys(cells)).toEqual(
      keys([
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 4, y: 3 }
      ])
    );
  });

  it('line along a diagonal stays on the diagonal', () => {
    const cells = aoeCells(open, { x: 0, y: 0 }, 'line', 15, { x: 1, y: 1 });
    expect(keys(cells)).toEqual(
      keys([
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ])
    );
  });

  it('cone and line return nothing without a direction', () => {
    expect(aoeCells(open, { x: 3, y: 3 }, 'cone', 15)).toEqual([]);
    expect(aoeCells(open, { x: 3, y: 3 }, 'line', 15, { x: 3, y: 3 })).toEqual([]);
  });

  it('cube without direction centers on the origin', () => {
    const cells = keys(aoeCells(open, { x: 2, y: 2 }, 'cube', 10));
    expect(cells).toEqual(keys([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 }
    ]));
  });

  it('cube with a direction extends from the facing edge', () => {
    const cells = keys(aoeCells(open, { x: 2, y: 2 }, 'cube', 10, { x: 3, y: 2 }));
    expect(cells).toEqual(keys([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 }
    ]));
  });
});

describe('threatenedCells', () => {
  const grid = gridFromAscii(`
    .....
    .....
    .....
    .....
    .....
  `);

  it('marks the melee envelope of enemies only', () => {
    const threats = threatenedCells(
      grid,
      [
        { cell: { x: 1, y: 1 }, team: 'monsters' },
        { cell: { x: 4, y: 4 }, team: 'pc' }
      ],
      'pc'
    );
    expect(threats.size).toBe(9);
    expect(threats.has('0,0')).toBe(true);
    expect(threats.has('2,2')).toBe(true);
    expect(threats.has('3,3')).toBe(false);
  });

  it('extends with reach and footprint', () => {
    const threats = threatenedCells(
      grid,
      [{ cell: { x: 0, y: 0 }, team: 'monsters', reachFt: 10, sizeCells: 2 }],
      'pc'
    );
    expect(threats.has('3,3')).toBe(true);
    expect(threats.has('4,4')).toBe(false);
  });

  it('clips to the board', () => {
    const threats = threatenedCells(grid, [{ cell: { x: 0, y: 0 }, team: 'monsters' }], 'pc');
    expect(threats.size).toBe(4);
  });
});

describe('footprintCells', () => {
  it('expands Large+ tokens', () => {
    expect(keys(footprintCells({ x: 1, y: 1 }, 2))).toEqual(
      keys([
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 }
      ])
    );
    expect(footprintCells({ x: 0, y: 0 }, 1)).toEqual([{ x: 0, y: 0 }]);
  });
});
