import { describe, it, expect } from 'vitest';
import { applyDamageDelta, applyHealDelta } from '../hp';

describe('applyDamageDelta', () => {
  it('subtracts from currentHp when no temp', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 0 }, 5)).toEqual({ currentHp: 15, tempHp: 0 });
  });

  it('temp HP absorbs first', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 4 }, 3)).toEqual({ currentHp: 20, tempHp: 1 });
  });

  it('temp HP absorbs partial, remainder hits current', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 4 }, 7)).toEqual({ currentHp: 17, tempHp: 0 });
  });

  it('current HP floors at 0', () => {
    expect(applyDamageDelta({ currentHp: 3, tempHp: 0 }, 10)).toEqual({ currentHp: 0, tempHp: 0 });
  });

  it('preserves other fields on the state object', () => {
    const next = applyDamageDelta(
      { currentHp: 10, tempHp: 0, conditions: ['prone'], maxHp: 25 },
      4
    );
    expect(next).toEqual({ currentHp: 6, tempHp: 0, conditions: ['prone'], maxHp: 25 });
  });

  it('null currentHp passes through (temp HP still drains)', () => {
    expect(applyDamageDelta({ currentHp: null, tempHp: 5 }, 3)).toEqual({
      currentHp: null,
      tempHp: 2
    });
  });

  it('clamps negative amounts to zero (no heal via damage)', () => {
    expect(applyDamageDelta({ currentHp: 10, tempHp: 0 }, -5)).toEqual({
      currentHp: 10,
      tempHp: 0
    });
  });

  it('floors fractional amounts', () => {
    expect(applyDamageDelta({ currentHp: 10, tempHp: 0 }, 3.9)).toEqual({
      currentHp: 7,
      tempHp: 0
    });
  });

  it('handles missing tempHp (legacy data) as 0', () => {
    expect(applyDamageDelta({ currentHp: 10, tempHp: undefined as unknown as number }, 4)).toEqual({
      currentHp: 6,
      tempHp: 0
    });
  });

  // Locks Phase 2a: overlay HP pools (Arcane Ward / Bladesong THP shape)
  // absorb after tempHp but before currentHp. Aggregate per-pool tracking
  // is the runtime's concern; this layer only reads/writes the sum.
  it('absorbs into overlayHp after tempHp, before currentHp', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 0, overlayHp: 6 }, 4)).toEqual({
      currentHp: 20,
      tempHp: 0,
      overlayHp: 2
    });
  });

  it('overlay absorbs partial, remainder hits current', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 0, overlayHp: 3 }, 7)).toEqual({
      currentHp: 16,
      tempHp: 0,
      overlayHp: 0
    });
  });

  it('temp absorbs before overlay (full damage stack: temp → overlay → current)', () => {
    expect(applyDamageDelta({ currentHp: 20, tempHp: 2, overlayHp: 3 }, 8)).toEqual({
      currentHp: 17,
      tempHp: 0,
      overlayHp: 0
    });
  });

  it('omits overlayHp from result when not set on input (backwards compat)', () => {
    const next = applyDamageDelta({ currentHp: 10, tempHp: 0 }, 4);
    expect(next).toEqual({ currentHp: 6, tempHp: 0 });
    expect('overlayHp' in next).toBe(false);
  });
});

describe('applyHealDelta', () => {
  it('adds to currentHp', () => {
    expect(applyHealDelta({ currentHp: 10, tempHp: 0 }, 5, 30)).toEqual({
      currentHp: 15,
      tempHp: 0
    });
  });

  it('caps at maxHp', () => {
    expect(applyHealDelta({ currentHp: 25, tempHp: 0 }, 10, 30)).toEqual({
      currentHp: 30,
      tempHp: 0
    });
  });

  it('no cap when maxHp is null', () => {
    expect(applyHealDelta({ currentHp: 10, tempHp: 0 }, 99, null)).toEqual({
      currentHp: 109,
      tempHp: 0
    });
  });

  it('does not touch tempHp', () => {
    expect(applyHealDelta({ currentHp: 10, tempHp: 5 }, 3, 30)).toEqual({
      currentHp: 13,
      tempHp: 5
    });
  });

  it('null currentHp passes through', () => {
    expect(applyHealDelta({ currentHp: null, tempHp: 0 }, 5, 30)).toEqual({
      currentHp: null,
      tempHp: 0
    });
  });

  it('clamps negative amounts to zero (no damage via heal)', () => {
    expect(applyHealDelta({ currentHp: 10, tempHp: 0 }, -5, 30)).toEqual({
      currentHp: 10,
      tempHp: 0
    });
  });

  it('floors fractional amounts', () => {
    expect(applyHealDelta({ currentHp: 10, tempHp: 0 }, 3.9, 30)).toEqual({
      currentHp: 13,
      tempHp: 0
    });
  });

  it('preserves other fields', () => {
    const next = applyHealDelta(
      { currentHp: 10, tempHp: 0, conditions: ['prone'] },
      5,
      30
    );
    expect(next).toEqual({ currentHp: 15, tempHp: 0, conditions: ['prone'] });
  });
});
