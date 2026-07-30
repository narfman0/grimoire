import { describe, it, expect } from 'vitest';
import { visibleAnnotations, type CellNote } from '../board-visibility';
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
