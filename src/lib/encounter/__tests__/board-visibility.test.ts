import { describe, it, expect } from 'vitest';
import { visibleAnnotations, visibleFloorLinks, type CellNote } from '../board-visibility';
import { encodeRuns } from '$lib/board/rle';

/** 3×2 board whose only revealed cell is (1,0). */
const board = { w: 3, h: 2, revealedJson: encodeRuns([0, 1, 0, 0, 0, 0]) };

const notes: Record<string, CellNote> = {
  '1,0': { note: 'lever behind the tapestry' },
  '2,0': { note: '10 ft ledge' },
  '0,1': { note: 'pressure plate', dmOnly: true },
  '1,1': { note: 'the trap resets', dmOnly: true }
};

describe('visibleAnnotations', () => {
  it('gives the DM every note', () => {
    expect(visibleAnnotations(notes, board, true)).toEqual(notes);
  });

  it('gives a player only shared notes on revealed cells', () => {
    // (1,0) is revealed and shared → in. (2,0) is shared but fogged, and the
    // dmOnly pair are out whatever the fog says.
    expect(visibleAnnotations(notes, board, false)).toEqual({
      '1,0': { note: 'lever behind the tapestry' }
    });
  });

  it('strips the dmOnly flag from what a player receives', () => {
    const out = visibleAnnotations({ '1,0': { note: 'shared' } }, board, false);
    expect(out['1,0']).toEqual({ note: 'shared' });
    expect('dmOnly' in out['1,0']).toBe(false);
  });

  it('reveals a fogged note once its cell is revealed', () => {
    const lit = { ...board, revealedJson: encodeRuns([1, 1, 1, 1, 1, 1]) };
    expect(Object.keys(visibleAnnotations(notes, lit, false)).sort()).toEqual(['1,0', '2,0']);
  });

  it('fails closed on a corrupt fog mask', () => {
    const broken = { ...board, revealedJson: 'not-an-rle-string' };
    expect(visibleAnnotations(notes, broken, false)).toEqual({});
    // …but the DM still gets their notes: the fog isn't consulted for them.
    expect(visibleAnnotations(notes, broken, true)).toEqual(notes);
  });

  it('drops out-of-bounds and malformed keys', () => {
    const lit = { ...board, revealedJson: encodeRuns([1, 1, 1, 1, 1, 1]) };
    const weird: Record<string, CellNote> = {
      '9,9': { note: 'off the board' },
      nonsense: { note: 'not a cell' },
      '0,0': { note: 'fine' }
    };
    expect(visibleAnnotations(weird, lit, false)).toEqual({ '0,0': { note: 'fine' } });
  });

  it('is empty for no notes, and for a player with no board', () => {
    expect(visibleAnnotations(null, board, false)).toEqual({});
    expect(visibleAnnotations({}, board, true)).toEqual({});
    expect(visibleAnnotations(notes, null, false)).toEqual({});
  });

  it('returns a copy, so a caller cannot mutate the stored map', () => {
    const out = visibleAnnotations(notes, board, true);
    out['5,5'] = { note: 'injected' };
    expect(notes['5,5']).toBeUndefined();
  });
});

describe('visibleFloorLinks', () => {
  const floors = [
    // Floor 0: only (5,0) revealed — the head of the stairs.
    { floorIdx: 0, w: 6, h: 4, revealedJson: encodeRuns([0, 0, 0, 0, 0, 1, ...new Array(18).fill(0)]) },
    // Floor 1: fully fogged.
    { floorIdx: 1, w: 6, h: 4, revealedJson: encodeRuns(new Array(24).fill(0)) }
  ];
  const links = [
    {
      id: 'L1',
      kind: 'stairs',
      costFt: 5,
      a: { floorIdx: 0, x: 5, y: 0 },
      b: { floorIdx: 1, x: 0, y: 3 }
    },
    {
      id: 'L2',
      kind: 'rope',
      costFt: 10,
      a: { floorIdx: 0, x: 1, y: 1 },
      b: { floorIdx: 1, x: 1, y: 1 }
    }
  ];

  it('gives the DM every link, both ends', () => {
    const out = visibleFloorLinks(links, floors, true);
    expect(out).toHaveLength(2);
    expect(out[0].b).toEqual({ floorIdx: 1, x: 0, y: 3 });
  });

  it('gives a player only links with a revealed endpoint, far end withheld', () => {
    const out = visibleFloorLinks(links, floors, false);
    // L1's head is revealed → it ships, but "leads somewhere": b is null.
    // L2 is fully fogged → it does not exist yet.
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('L1');
    expect(out[0].a).toEqual({ floorIdx: 0, x: 5, y: 0 });
    expect(out[0].b).toBeNull();
  });

  it('ships both ends once both are revealed, normalized near-first', () => {
    const lit = [
      floors[0],
      { floorIdx: 1, w: 6, h: 4, revealedJson: encodeRuns(new Array(24).fill(1)) }
    ];
    const out = visibleFloorLinks(links, lit, false);
    const l1 = out.find((l) => l.id === 'L1')!;
    expect(l1.b).toEqual({ floorIdx: 1, x: 0, y: 3 });
    // L2's only revealed endpoint is on floor 1 → it is normalized into `a`.
    const l2 = out.find((l) => l.id === 'L2')!;
    expect(l2.a.floorIdx).toBe(1);
    expect(l2.b).toBeNull();
  });

  it('fails closed on a corrupt fog mask', () => {
    const broken = [{ floorIdx: 0, w: 6, h: 4, revealedJson: 'garbage' }];
    expect(visibleFloorLinks(links, broken, false)).toEqual([]);
    expect(visibleFloorLinks(links, broken, true)).toHaveLength(2);
  });
});
