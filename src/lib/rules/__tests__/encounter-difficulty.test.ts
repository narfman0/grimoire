import { describe, it, expect } from 'vitest';
import {
  encounterDifficulty,
  encounterMultiplier,
  parseCr,
  partyThresholds,
  rateAdjustedXp,
  thresholdsForLevel,
  xpForCr
} from '../encounter-difficulty';

/** Four level-3 PCs — the canonical DMG example party. Thresholds:
 *  easy 300, medium 600, hard 900, deadly 1600. */
const PARTY_4x3 = [3, 3, 3, 3];

describe('parseCr', () => {
  it('reads whole-number CRs from either a number or a string', () => {
    expect(parseCr(5)).toBe(5);
    expect(parseCr('5')).toBe(5);
    expect(parseCr(' 12 ')).toBe(12);
    expect(parseCr(0)).toBe(0);
    expect(parseCr('0')).toBe(0);
  });

  it('reads the three fractional CRs statblocks actually use', () => {
    expect(parseCr('1/8')).toBe(0.125);
    expect(parseCr('1/4')).toBe(0.25);
    expect(parseCr('1/2')).toBe(0.5);
  });

  it('returns null for unratable input', () => {
    expect(parseCr(null)).toBeNull();
    expect(parseCr(undefined)).toBeNull();
    expect(parseCr('')).toBeNull();
    expect(parseCr('—')).toBeNull();
    expect(parseCr('unknown')).toBeNull();
    expect(parseCr('1/0')).toBeNull();
    expect(parseCr(-1)).toBeNull();
    expect(parseCr(Number.NaN)).toBeNull();
  });
});

describe('xpForCr', () => {
  it('maps the low end of the table', () => {
    expect(xpForCr(0)).toBe(10);
    expect(xpForCr('1/8')).toBe(25);
    expect(xpForCr('1/4')).toBe(50);
    expect(xpForCr('1/2')).toBe(100);
    expect(xpForCr(1)).toBe(200);
  });

  it('maps the high end of the table', () => {
    expect(xpForCr(20)).toBe(25000);
    expect(xpForCr(24)).toBe(62000);
    expect(xpForCr(30)).toBe(155000);
  });

  it('returns null off the table', () => {
    expect(xpForCr(3.5)).toBeNull();
    expect(xpForCr(31)).toBeNull();
    expect(xpForCr('?')).toBeNull();
  });
});

describe('thresholdsForLevel', () => {
  it('reads the per-character table', () => {
    expect(thresholdsForLevel(1)).toEqual({ easy: 25, medium: 50, hard: 75, deadly: 100 });
    expect(thresholdsForLevel(5)).toEqual({ easy: 250, medium: 500, hard: 750, deadly: 1100 });
    expect(thresholdsForLevel(20)).toEqual({
      easy: 2800,
      medium: 5700,
      hard: 8500,
      deadly: 12700
    });
  });

  it('clamps out-of-range levels into 1..20', () => {
    expect(thresholdsForLevel(0)).toEqual(thresholdsForLevel(1));
    expect(thresholdsForLevel(25)).toEqual(thresholdsForLevel(20));
    expect(thresholdsForLevel(4.9)).toEqual(thresholdsForLevel(4));
  });
});

describe('partyThresholds', () => {
  it('sums per-character thresholds for a uniform party', () => {
    expect(partyThresholds(PARTY_4x3)).toEqual({
      easy: 300,
      medium: 600,
      hard: 900,
      deadly: 1600
    });
  });

  it('sums each character at its own level for a mixed-level party', () => {
    // levels 1 + 5: easy 25+250, medium 50+500, hard 75+750, deadly 100+1100
    expect(partyThresholds([1, 5])).toEqual({
      easy: 275,
      medium: 550,
      hard: 825,
      deadly: 1200
    });
  });

  it('zeroes out for an empty party and skips junk levels', () => {
    expect(partyThresholds([])).toEqual({ easy: 0, medium: 0, hard: 0, deadly: 0 });
    expect(partyThresholds([0, -3, Number.NaN])).toEqual({
      easy: 0,
      medium: 0,
      hard: 0,
      deadly: 0
    });
  });
});

describe('encounterMultiplier', () => {
  // Boundaries of the DMG multiplier table with a "standard" 4-person party.
  it('walks the tiers at the 1/2/3/7/11/15 boundaries', () => {
    expect(encounterMultiplier(1, 4)).toBe(1);
    expect(encounterMultiplier(2, 4)).toBe(1.5);
    expect(encounterMultiplier(3, 4)).toBe(2);
    expect(encounterMultiplier(6, 4)).toBe(2);
    expect(encounterMultiplier(7, 4)).toBe(2.5);
    expect(encounterMultiplier(10, 4)).toBe(2.5);
    expect(encounterMultiplier(11, 4)).toBe(3);
    expect(encounterMultiplier(14, 4)).toBe(3);
    expect(encounterMultiplier(15, 4)).toBe(4);
    expect(encounterMultiplier(40, 4)).toBe(4);
  });

  it('steps one tier up for a party smaller than 3', () => {
    expect(encounterMultiplier(1, 2)).toBe(1.5);
    expect(encounterMultiplier(2, 2)).toBe(2);
    expect(encounterMultiplier(3, 1)).toBe(2.5);
    expect(encounterMultiplier(15, 2)).toBe(4); // already at the top — clamps
  });

  it('steps one tier down for a party larger than 5', () => {
    expect(encounterMultiplier(1, 6)).toBe(0.5); // the only way to reach x0.5
    expect(encounterMultiplier(2, 6)).toBe(1);
    expect(encounterMultiplier(3, 8)).toBe(1.5);
    expect(encounterMultiplier(15, 6)).toBe(3);
  });

  it('leaves 3..5 person parties unadjusted', () => {
    expect(encounterMultiplier(3, 3)).toBe(2);
    expect(encounterMultiplier(3, 5)).toBe(2);
  });

  it('is x1 for an empty roster and unadjusted for an unknown party', () => {
    expect(encounterMultiplier(0, 4)).toBe(1);
    expect(encounterMultiplier(0, 0)).toBe(1);
    expect(encounterMultiplier(4, 0)).toBe(2);
  });
});

describe('rateAdjustedXp', () => {
  const t = partyThresholds(PARTY_4x3); // 300 / 600 / 900 / 1600

  it('bands on the inclusive lower edge of each threshold', () => {
    expect(rateAdjustedXp(299, t, 4)).toBe('trivial');
    expect(rateAdjustedXp(300, t, 4)).toBe('easy');
    expect(rateAdjustedXp(599, t, 4)).toBe('easy');
    expect(rateAdjustedXp(600, t, 4)).toBe('medium');
    expect(rateAdjustedXp(899, t, 4)).toBe('medium');
    expect(rateAdjustedXp(900, t, 4)).toBe('hard');
    expect(rateAdjustedXp(1599, t, 4)).toBe('hard');
    expect(rateAdjustedXp(1600, t, 4)).toBe('deadly');
    expect(rateAdjustedXp(999999, t, 4)).toBe('deadly');
  });

  it('is unknown without a party', () => {
    expect(rateAdjustedXp(5000, partyThresholds([]), 0)).toBe('unknown');
  });
});

describe('encounterDifficulty', () => {
  it('rates a single goblin against four level-3 PCs as trivial', () => {
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      monsters: [{ name: 'Goblin', cr: '1/4', xp: 50 }]
    });
    expect(r.edition).toBe('2014');
    expect(r.partySize).toBe(4);
    expect(r.monsterCount).toBe(1);
    expect(r.baseXp).toBe(50);
    expect(r.multiplier).toBe(1);
    expect(r.adjustedXp).toBe(50);
    expect(r.rating).toBe('trivial');
    expect(r.unrated).toEqual([]);
  });

  it('hits each band as the roster grows (four level-3 PCs)', () => {
    const rate = (count: number) =>
      encounterDifficulty({
        partyLevels: PARTY_4x3,
        monsters: [{ name: 'Goblin', cr: '1/4', xp: 50, count }]
      });
    // 4 goblins: 200 base x2 = 400 -> easy (>=300)
    expect(rate(4).adjustedXp).toBe(400);
    expect(rate(4).rating).toBe('easy');
    // 6 goblins: 300 base x2 = 600 -> medium (>=600)
    expect(rate(6).rating).toBe('medium');
    // 8 goblins: 400 base x2.5 = 1000 -> hard (>=900)
    expect(rate(8).multiplier).toBe(2.5);
    expect(rate(8).adjustedXp).toBe(1000);
    expect(rate(8).rating).toBe('hard');
    // 15 goblins: 750 base x4 = 3000 -> deadly (>=1600)
    expect(rate(15).multiplier).toBe(4);
    expect(rate(15).adjustedXp).toBe(3000);
    expect(rate(15).rating).toBe('deadly');
  });

  it('prefers the statblock XP over the CR table when they disagree', () => {
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      // Homebrew: CR 1 would be 200, but the sheet says 500.
      monsters: [{ name: 'Custom', cr: 1, xp: 500 }]
    });
    expect(r.baseXp).toBe(500);
  });

  it('falls back to the CR table when no XP is given', () => {
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      monsters: [{ name: 'Ogre', cr: 2 }]
    });
    expect(r.baseXp).toBe(450);
    expect(r.unrated).toEqual([]);
  });

  it('reports monsters with neither XP nor a table CR but still counts them', () => {
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      monsters: [
        { name: 'Goblin', cr: '1/4', xp: 50 },
        { name: 'Mystery Blob', cr: '—' },
        { cr: null }
      ]
    });
    expect(r.baseXp).toBe(50);
    expect(r.monsterCount).toBe(3); // all three still drive the multiplier
    expect(r.multiplier).toBe(2);
    expect(r.adjustedXp).toBe(100);
    expect(r.unrated).toEqual(['Mystery Blob', '(unnamed)']);
  });

  it('returns rating=unknown and zero thresholds for an empty party', () => {
    const r = encounterDifficulty({
      partyLevels: [],
      monsters: [{ name: 'Adult Red Dragon', cr: 17 }]
    });
    expect(r.partySize).toBe(0);
    expect(r.baseXp).toBe(18000);
    expect(r.multiplier).toBe(1); // no party -> no size adjustment
    expect(r.thresholds).toEqual({ easy: 0, medium: 0, hard: 0, deadly: 0 });
    expect(r.rating).toBe('unknown');
    // xpPerCharacter degrades to the raw total rather than dividing by zero.
    expect(r.xpPerCharacter).toBe(18000);
  });

  it('returns a trivial 0-XP result for an empty roster', () => {
    const r = encounterDifficulty({ partyLevels: PARTY_4x3, monsters: [] });
    expect(r.monsterCount).toBe(0);
    expect(r.baseXp).toBe(0);
    expect(r.multiplier).toBe(1);
    expect(r.adjustedXp).toBe(0);
    expect(r.xpPerCharacter).toBe(0);
    expect(r.rating).toBe('trivial');
  });

  it('returns unknown for an empty party AND an empty roster', () => {
    expect(encounterDifficulty({ partyLevels: [], monsters: [] }).rating).toBe('unknown');
  });

  it('applies the small-party bump: 2 PCs face a harder rating than 4', () => {
    const monsters = [{ name: 'Goblin', cr: '1/4', xp: 50, count: 4 }];
    const big = encounterDifficulty({ partyLevels: [3, 3, 3, 3], monsters });
    const small = encounterDifficulty({ partyLevels: [3, 3], monsters });
    expect(big.multiplier).toBe(2);
    expect(small.multiplier).toBe(2.5);
    // 200 base: 400 vs a 4-PC easy(300); 500 vs a 2-PC deadly(800)/hard(450).
    expect(big.rating).toBe('easy');
    expect(small.adjustedXp).toBe(500);
    expect(small.rating).toBe('hard');
  });

  it('applies the large-party step-down', () => {
    const monsters = [{ name: 'Goblin', cr: '1/4', xp: 50, count: 4 }];
    const six = encounterDifficulty({ partyLevels: [3, 3, 3, 3, 3, 3], monsters });
    expect(six.multiplier).toBe(1.5);
    expect(six.adjustedXp).toBe(300);
    expect(six.rating).toBe('trivial'); // 6x level 3 -> easy is 450
  });

  it('handles a mixed-level party end to end', () => {
    const r = encounterDifficulty({
      partyLevels: [1, 3, 5, 7],
      monsters: [{ name: 'Ogre', cr: 2, xp: 450, count: 2 }]
    });
    // thresholds: easy 25+75+250+350=700, medium 50+150+500+750=1450,
    // hard 75+225+750+1100=2150, deadly 100+400+1100+1700=3300
    expect(r.thresholds).toEqual({ easy: 700, medium: 1450, hard: 2150, deadly: 3300 });
    expect(r.baseXp).toBe(900);
    expect(r.multiplier).toBe(1.5);
    expect(r.adjustedXp).toBe(1350);
    expect(r.rating).toBe('easy');
    expect(r.xpPerCharacter).toBe(225);
  });

  it('ignores non-positive counts entirely', () => {
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      monsters: [
        { name: 'Goblin', cr: '1/4', xp: 50, count: 0 },
        { name: 'Goblin', cr: '1/4', xp: 50, count: -2 },
        { name: 'Goblin', cr: '1/4', xp: 50 }
      ]
    });
    expect(r.monsterCount).toBe(1);
    expect(r.baseXp).toBe(50);
  });

  it('rounds the adjusted total to an integer', () => {
    // x1.5 against an odd base XP (CR 0 = 10 XP, three of them = 30... use 25)
    const r = encounterDifficulty({
      partyLevels: PARTY_4x3,
      monsters: [{ name: 'Kobold', cr: '1/8', count: 2 }] // 50 base x1.5 = 75
    });
    expect(r.adjustedXp).toBe(75);
    expect(Number.isInteger(r.adjustedXp)).toBe(true);
  });
});
