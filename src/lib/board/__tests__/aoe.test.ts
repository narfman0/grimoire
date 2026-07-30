import { describe, it, expect } from 'vitest';
import { AOE_PRESETS, coverEffect, tokensInCells } from '../aoe';
import { aoeCells, coverBetween } from '../geometry';
import { gridFromAscii } from './fixtures';

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
