import { describe, it, expect } from 'vitest';
import { AOE_PRESETS, coverEffect, targetsInRangeCells, tokensInCells } from '../aoe';
import { aoeCells, coverBetween } from '../geometry';
import { gridFromAscii } from './fixtures';
import { cellKey } from '../types';

describe('tokensInCells', () => {
  const tokens = [
    { id: 'a', x: 1, y: 1, sizeCells: 1 },
    { id: 'b', x: 5, y: 5, sizeCells: 1 },
    // Huge creature anchored at (3,3), occupying 3×3 through (5,5)…
    { id: 'huge', x: 3, y: 3, sizeCells: 3 }
  ];

  it('catches a token whose anchor cell is covered', () => {
    expect(tokensInCells([{ x: 1, y: 1 }], tokens)).toEqual(['a']);
  });

  it('catches a big token clipped by one of its non-anchor squares', () => {
    // (4,4) is inside the Huge footprint but is nobody's anchor.
    expect(tokensInCells([{ x: 4, y: 4 }], tokens)).toEqual(['huge']);
  });

  it('returns every overlap in token order, not cell order', () => {
    expect(
      tokensInCells(
        [
          { x: 5, y: 5 },
          { x: 1, y: 1 }
        ],
        tokens
      )
    ).toEqual(['a', 'b', 'huge']);
  });

  it('returns nothing for an empty template', () => {
    expect(tokensInCells([], tokens)).toEqual([]);
  });

  it('does not double-count a token covered on several cells', () => {
    expect(
      tokensInCells(
        [
          { x: 3, y: 3 },
          { x: 4, y: 4 },
          { x: 5, y: 3 }
        ],
        tokens
      )
    ).toEqual(['huge']);
  });

  // The end-to-end shape the board panel uses: geometry → caught creatures.
  it('reports who a fireball centred on a corridor catches', () => {
    const grid = gridFromAscii(`
      #######
      #.....#
      #..#..#
      #.....#
      #######
    `);
    const cells = aoeCells(grid, { x: 2, y: 2 }, 'sphere', 10);
    const caught = tokensInCells(cells, [
      { id: 'near', x: 2, y: 1, sizeCells: 1 },
      { id: 'far', x: 5, y: 3, sizeCells: 1 }
    ]);
    expect(caught).toEqual(['near']);
  });
});

describe('coverEffect', () => {
  it('maps each verdict to its 5e bonus', () => {
    expect(coverEffect('none')).toEqual({ bonus: 0, label: '', untargetable: false });
    expect(coverEffect('half').bonus).toBe(2);
    expect(coverEffect('three-quarters').bonus).toBe(5);
  });

  it('marks full cover untargetable rather than giving it a number', () => {
    const full = coverEffect('full');
    expect(full.untargetable).toBe(true);
    expect(full.bonus).toBe(0);
    expect(full.label).toMatch(/cannot be targeted/);
  });

  it('labels what the board readout shows', () => {
    // Foliage grants half cover; the readout is the chip's text verbatim.
    const grid = gridFromAscii(`
      .....
      ..F..
      .....
    `);
    const cover = coverBetween(grid, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(coverEffect(cover).label).toBe('half cover — +2 AC');
  });
});

describe('AOE_PRESETS', () => {
  it('are all positive multiples of a 5 ft cell', () => {
    for (const p of AOE_PRESETS) {
      expect(p.sizeFt).toBeGreaterThan(0);
      expect(p.sizeFt % 5).toBe(0);
      expect(p.label).toContain('(');
    }
  });
});

describe('targetsInRangeCells', () => {
  const grid = gridFromAscii(`
    .........
    .........
    .........
  `);
  const tokens = [
    { id: 'me', x: 0, y: 1, sizeCells: 1, team: 'pc' },
    { id: 'ally', x: 1, y: 1, sizeCells: 1, team: 'pc' },
    { id: 'near', x: 2, y: 1, sizeCells: 1, team: 'foe' },
    { id: 'far', x: 8, y: 1, sizeCells: 1, team: 'foe' },
    // Huge foe anchored at (5,0): footprint runs to (7,2).
    { id: 'huge', x: 5, y: 0, sizeCells: 3, team: 'foe' }
  ];

  it('highlights only hostile tokens the range reaches', () => {
    const out = targetsInRangeCells(grid, { x: 0, y: 1 }, tokens, 'pc', 10, 'me');
    expect(out.has(cellKey({ x: 2, y: 1 }))).toBe(true); // near, 10 ft
    expect(out.has(cellKey({ x: 1, y: 1 }))).toBe(false); // ally
    expect(out.has(cellKey({ x: 8, y: 1 }))).toBe(false); // far, 40 ft
  });

  it('measures to the nearest square of a big creature and lights its whole shape', () => {
    // From (3,1): the Huge foe's nearest cell (5,0..) is 10 ft away, so a
    // 10 ft reach catches it — and all 9 of its cells highlight.
    const out = targetsInRangeCells(grid, { x: 3, y: 1 }, tokens, 'pc', 10, 'me');
    expect(out.has(cellKey({ x: 5, y: 0 }))).toBe(true);
    expect(out.has(cellKey({ x: 7, y: 2 }))).toBe(true);
  });

  it('melee 5 ft from a non-adjacent cell reaches nothing', () => {
    const out = targetsInRangeCells(grid, { x: 0, y: 1 }, tokens, 'pc', 5, 'me');
    expect(out.size).toBe(0);
  });

  it('never targets the attacker themselves, whatever team math says', () => {
    const out = targetsInRangeCells(
      grid,
      { x: 0, y: 1 },
      [{ id: 'me', x: 0, y: 1, sizeCells: 1, team: 'foe' }],
      'pc',
      60,
      'me'
    );
    expect(out.size).toBe(0);
  });
});
