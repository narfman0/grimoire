import { describe, it, expect } from 'vitest';
import { linkAt, linkExit, validateLinks } from '../links';
import { DEFAULT_LINK_COST_FT, LINK_GLYPHS, LINK_KINDS, type Dungeon, type FloorLink } from '../dungeon';
import { encodeRuns } from '../rle';

const floor = (idx: number, w = 6, h = 4) => ({
  idx,
  name: `Floor ${idx}`,
  board: { w, h, cellFt: 5, tiles: encodeRuns(new Array(w * h).fill(1)) }
});

const stairs: FloorLink = {
  id: 'L1',
  kind: 'stairs',
  a: { floorIdx: 0, x: 5, y: 0 },
  b: { floorIdx: 1, x: 0, y: 3 },
  costFt: 5
};

describe('linkAt', () => {
  it('finds a link by either endpoint, floor-scoped', () => {
    expect(linkAt([stairs], 0, { x: 5, y: 0 })).toBe(stairs);
    expect(linkAt([stairs], 1, { x: 0, y: 3 })).toBe(stairs);
    // Same cell, wrong floor — the staircase's head is not its foot.
    expect(linkAt([stairs], 1, { x: 5, y: 0 })).toBeUndefined();
    expect(linkAt([stairs], 0, { x: 4, y: 0 })).toBeUndefined();
  });
});

describe('linkExit', () => {
  it('comes out at the other end from either side', () => {
    expect(linkExit(stairs, 0, { x: 5, y: 0 })).toEqual({ floorIdx: 1, x: 0, y: 3 });
    expect(linkExit(stairs, 1, { x: 0, y: 3 })).toEqual({ floorIdx: 0, x: 5, y: 0 });
  });

  it('refuses a one-way link taken backwards', () => {
    const chute: FloorLink = { ...stairs, id: 'L2', kind: 'hatch', oneWay: true };
    expect(linkExit(chute, 0, { x: 5, y: 0 })).toEqual({ floorIdx: 1, x: 0, y: 3 });
    expect(linkExit(chute, 1, { x: 0, y: 3 })).toBeNull();
  });

  it('returns null when not standing on an endpoint', () => {
    expect(linkExit(stairs, 0, { x: 0, y: 0 })).toBeNull();
  });
});

describe('validateLinks', () => {
  const base: Dungeon = { floors: [floor(0), floor(1)], links: [stairs] };

  it('accepts a coherent set', () => {
    expect(validateLinks(base)).toEqual([]);
  });

  it('rejects endpoints on missing floors and off the grid', () => {
    const bad: Dungeon = {
      ...base,
      links: [
        { ...stairs, id: 'L2', b: { floorIdx: 7, x: 0, y: 0 } },
        { ...stairs, id: 'L3', a: { floorIdx: 0, x: 99, y: 0 } }
      ]
    };
    const problems = validateLinks(bad);
    expect(problems.some((p) => p.includes('floor 7 does not exist'))).toBe(true);
    expect(problems.some((p) => p.includes('off floor 0'))).toBe(true);
  });

  it('rejects two links sharing an endpoint cell — which would a token take?', () => {
    const clash: Dungeon = {
      ...base,
      links: [stairs, { ...stairs, id: 'L2', b: { floorIdx: 1, x: 1, y: 1 } }]
    };
    expect(validateLinks(clash).some((p) => p.includes('already belongs to link "L1"'))).toBe(true);
  });

  it('rejects self-loops, duplicate ids and non-positive costs', () => {
    const bad: Dungeon = {
      floors: [floor(0)],
      links: [
        {
          id: 'X',
          kind: 'passage',
          a: { floorIdx: 0, x: 1, y: 1 },
          b: { floorIdx: 0, x: 1, y: 1 },
          costFt: 0
        },
        { ...stairs, id: 'X', a: { floorIdx: 0, x: 2, y: 2 }, b: { floorIdx: 0, x: 3, y: 3 } }
      ]
    };
    const problems = validateLinks(bad);
    expect(problems.some((p) => p.includes('connects a cell to itself'))).toBe(true);
    expect(problems.some((p) => p.includes('non-positive cost'))).toBe(true);
    expect(problems.some((p) => p.includes('duplicate link id'))).toBe(true);
  });
});

describe('link kind tables', () => {
  it('cover every kind exactly once', () => {
    expect(LINK_KINDS.sort()).toEqual(['hatch', 'ladder', 'passage', 'rope', 'stairs']);
    for (const k of LINK_KINDS) {
      expect(DEFAULT_LINK_COST_FT[k]).toBeGreaterThan(0);
      expect(LINK_GLYPHS[k].length).toBeGreaterThan(0);
    }
  });
});
