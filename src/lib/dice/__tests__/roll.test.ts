import { describe, expect, it } from 'vitest';
import { rollD20, rollPool } from '../roll';
import { faceRng, mulberry32 } from '../rng';
import { parseDice } from '../parse';

// Every assertion here is an exact value, not a range. `faceRng([a, b], sides)`
// makes successive dice of that size come up a, then b — so the tests read as
// "given these faces, this is the answer", which is the only way rules like
// "the floor applies after the advantage pick" can be pinned down.

const kept = (r: { dice: Array<{ kept: boolean; value: number }> }) =>
  r.dice.filter((d) => d.kept).map((d) => d.value);

describe('rollPool', () => {
  it('sums dice and the flat modifier', () => {
    const r = rollPool('2d6+3', {}, faceRng([4, 6], 6))!;
    expect(r.total).toBe(13);
    expect(kept(r)).toEqual([4, 6]);
    expect(r.detail).toBe('[4, 6] + 3 = 13');
  });

  it('handles a negative modifier', () => {
    const r = rollPool('1d8-1', {}, faceRng([5], 8))!;
    expect(r.total).toBe(4);
    expect(r.detail).toBe('[5] - 1 = 4');
  });

  it('returns null for an unparseable formula instead of throwing', () => {
    expect(rollPool('banana', {}, mulberry32(1))).toBeNull();
  });

  it('accepts a pre-parsed expression', () => {
    const r = rollPool(parseDice('1d6')!, {}, faceRng([3], 6))!;
    expect(r.total).toBe(3);
  });

  describe('dieMin (Great Weapon Fighting)', () => {
    it('floors each die independently, not the total', () => {
      // 1 and 2 both floor to 3; 6 is untouched. Flooring the *total* would
      // have given 9 here, which is a different and much worse rule.
      const r = rollPool('3d6', { dieMin: 3 }, faceRng([1, 2, 6], 6))!;
      expect(kept(r)).toEqual([3, 3, 6]);
      expect(r.total).toBe(12);
    });

    it('records the raw face so the floor is visible', () => {
      const r = rollPool('1d6', { dieMin: 3 }, faceRng([1], 6))!;
      expect(r.dice[0]).toMatchObject({ raw: 1, value: 3 });
      expect(r.detail).toBe('[1→3] = 3');
    });

    it('leaves dice at or above the floor alone', () => {
      const r = rollPool('1d6', { dieMin: 3 }, faceRng([3], 6))!;
      expect(r.dice[0].raw).toBeUndefined();
    });
  });

  describe('maximize', () => {
    it('takes every die at its ceiling', () => {
      const r = rollPool('2d6+3', { maximize: true }, faceRng([1, 1], 6))!;
      expect(r.total).toBe(15);
      expect(r.dice.every((d) => d.maximized)).toBe(true);
    });

    it('wins over dieMin rather than compounding with it', () => {
      const r = rollPool('1d6', { maximize: true, dieMin: 3 }, faceRng([1], 6))!;
      expect(r.total).toBe(6);
    });

    it('maximizes the doubled crit dice too', () => {
      const r = rollPool('2d6', { maximize: true, doubleDice: true }, faceRng([1], 6))!;
      expect(r.total).toBe(24);
      expect(r.dice).toHaveLength(4);
    });
  });

  describe('doubleDice (crits)', () => {
    it('doubles the dice but never the flat modifier', () => {
      const r = rollPool('2d6+3', { doubleDice: true }, faceRng([4], 6))!;
      expect(r.dice).toHaveLength(4);
      expect(r.total).toBe(19); // 4*4 + 3, not 4*4 + 6
    });

    it('marks the added dice as crit dice', () => {
      const r = rollPool('1d8', { doubleDice: true }, faceRng([5], 8))!;
      expect(r.dice.map((d) => d.origin)).toEqual([undefined, 'crit']);
    });
  });

  describe('extraDice (Savage Attacks)', () => {
    it('adds dice of the first term size', () => {
      const r = rollPool('1d8+1d6', { extraDice: 1 }, faceRng([2], 8))!;
      const extra = r.dice.filter((d) => d.origin === 'crit');
      expect(extra).toHaveLength(1);
      expect(extra[0].sides).toBe(8);
    });

    it('is added once even on a crit — doubling must not double it', () => {
      // 2d8 doubled = 4 dice, plus exactly 1 extra = 5. A naive implementation
      // that appends before doubling would give 6.
      const r = rollPool('2d8', { doubleDice: true, extraDice: 1 }, faceRng([3], 8))!;
      expect(r.dice).toHaveLength(5);
      expect(r.total).toBe(15);
    });
  });

  describe('rerollAndKeepHigher (Savage Attacker)', () => {
    it('rerolls the whole pool once and keeps the better total', () => {
      // First pool 1+2 = 3, second 6+5 = 11. The set is rerolled, not each die.
      const r = rollPool('2d6', { rerollAndKeepHigher: true }, faceRng([1, 2, 6, 5], 6))!;
      expect(r.total).toBe(11);
      expect(kept(r)).toEqual([6, 5]);
    });

    it('keeps the first roll on a tie', () => {
      const r = rollPool('2d6', { rerollAndKeepHigher: true }, faceRng([3, 4, 4, 3], 6))!;
      expect(kept(r)).toEqual([3, 4]);
    });

    it('retains the losing pool as dropped dice', () => {
      const r = rollPool('1d6', { rerollAndKeepHigher: true }, faceRng([1, 6], 6))!;
      expect(r.dice).toHaveLength(2);
      expect(r.dice.filter((d) => !d.kept).map((d) => d.value)).toEqual([1]);
      expect(r.detail).toBe('[6, (1)] = 6');
    });
  });

  describe('keep pools', () => {
    it('keeps the highest N (4d6kh3 for ability scores)', () => {
      const r = rollPool('4d6kh3', {}, faceRng([6, 1, 4, 5], 6))!;
      expect(r.total).toBe(15);
      expect(kept(r).sort()).toEqual([4, 5, 6]);
    });

    it('keeps the lowest N', () => {
      const r = rollPool('4d6kl1', {}, faceRng([6, 1, 4, 5], 6))!;
      expect(r.total).toBe(1);
    });
  });

  describe('bonusDice', () => {
    it('adds Bless-style dice to the total', () => {
      const r = rollPool('1d6', { bonusDice: ['1d4'] }, (() => {
        const seq = [3 / 6, 3 / 4]; // d6 → 4, d4 → 4
        let i = 0;
        return () => seq[i++ % seq.length];
      })())!;
      expect(r.dice).toHaveLength(2);
      expect(r.dice[1].origin).toBe('bonus');
    });

    it('ignores an unparseable bonus die rather than failing the roll', () => {
      const r = rollPool('1d6', { bonusDice: ['banana'] }, faceRng([4], 6))!;
      expect(r.total).toBe(4);
      expect(r.dice).toHaveLength(1);
    });
  });
});

describe('rollD20', () => {
  it('rolls one die plus the modifier', () => {
    const r = rollD20(5, {}, faceRng([12], 20));
    expect(r.total).toBe(17);
    expect(r.d20).toMatchObject({ natural: 12, mode: 'normal', isCrit: false, isFumble: false });
    expect(r.formula).toBe('d20+5');
  });

  it('takes the higher die with advantage', () => {
    const r = rollD20(0, { advantage: true }, faceRng([7, 18], 20));
    expect(r.total).toBe(18);
    expect(r.d20!.mode).toBe('advantage');
    expect(r.detail).toBe('[(7), 18] = 18');
  });

  it('takes the lower die with disadvantage', () => {
    const r = rollD20(0, { disadvantage: true }, faceRng([7, 18], 20));
    expect(r.total).toBe(7);
  });

  it('cancels to a single straight roll when both apply', () => {
    const r = rollD20(0, { advantage: true, disadvantage: true }, faceRng([7, 18], 20));
    expect(r.dice).toHaveLength(1);
    expect(r.total).toBe(7);
    expect(r.d20!.mode).toBe('normal');
  });

  describe('d20Floor', () => {
    it('applies after the advantage pick, not before', () => {
      // Faces 4 and 9, floor 10. Advantage picks 9, then the floor lifts it to
      // 10. Flooring first would make both dice 10 and hide which was picked.
      const r = rollD20(0, { advantage: true, d20Floor: 10 }, faceRng([4, 9], 20));
      expect(r.total).toBe(10);
      const picked = r.dice.find((d) => d.kept)!;
      expect(picked).toMatchObject({ raw: 9, value: 10 });
      expect(r.dice.find((d) => !d.kept)!.value).toBe(4);
    });

    it('cannot manufacture a crit', () => {
      // Reliable Talent treats a low roll as 10; that is not a natural 10, and
      // a floor of 20 would still not be a natural 20.
      const r = rollD20(0, { d20Floor: 20 }, faceRng([3], 20));
      expect(r.total).toBe(20);
      expect(r.d20!.natural).toBe(3);
      expect(r.d20!.isCrit).toBe(false);
    });

    it('does not lower a die that already beat the floor', () => {
      const r = rollD20(0, { d20Floor: 10 }, faceRng([15], 20));
      expect(r.total).toBe(15);
      expect(r.dice[0].raw).toBeUndefined();
    });
  });

  describe('crit and fumble', () => {
    it('crits on a natural 20 by default', () => {
      expect(rollD20(0, {}, faceRng([20], 20)).d20!.isCrit).toBe(true);
    });

    it('honours a lowered crit threshold (Champion)', () => {
      expect(rollD20(0, { critThreshold: 19 }, faceRng([19], 20)).d20!.isCrit).toBe(true);
      expect(rollD20(0, { critThreshold: 20 }, faceRng([19], 20)).d20!.isCrit).toBe(false);
    });

    it('fumbles on a natural 1 regardless of modifier', () => {
      const r = rollD20(11, {}, faceRng([1], 20));
      expect(r.d20!.isFumble).toBe(true);
      expect(r.total).toBe(12);
    });

    it('classifies on the natural die, not the total', () => {
      const r = rollD20(20, {}, faceRng([2], 20));
      expect(r.total).toBe(22);
      expect(r.d20!.isCrit).toBe(false);
    });
  });

  it('adds bonus dice on top of the picked die', () => {
    const r = rollD20(0, { bonusDice: ['1d4'] }, (() => {
      const seq = [11 / 20, 3 / 4]; // d20 → 12, d4 → 4
      let i = 0;
      return () => seq[i++ % seq.length];
    })());
    expect(r.total).toBe(16);
    expect(r.dice[1].origin).toBe('bonus');
  });
});

describe('rng safety', () => {
  it('never produces a face outside 1..sides', () => {
    // Includes the pathological sources: always-0 and always-just-under-1.
    for (const rng of [() => 0, () => 0.9999999999999999, mulberry32(42)]) {
      for (let i = 0; i < 200; i++) {
        const r = rollPool('1d20', {}, rng)!;
        expect(r.total).toBeGreaterThanOrEqual(1);
        expect(r.total).toBeLessThanOrEqual(20);
      }
    }
  });

  it('is reproducible for a given seed', () => {
    const a = rollPool('4d6kh3', {}, mulberry32(7))!.total;
    const b = rollPool('4d6kh3', {}, mulberry32(7))!.total;
    expect(a).toBe(b);
  });

  it('covers the whole face range over many rolls', () => {
    const rng = mulberry32(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rollPool('1d20', {}, rng)!.total);
    expect(seen.size).toBe(20);
  });
});
