import { describe, it, expect } from 'vitest';
import {
  evaluateValue,
  proficiencyBonusFor,
  abilityModifier,
  rageDamageFor
} from '../evaluate';
import type { CharacterDocument } from '../types';

const ctx = {
  totalLevel: 5,
  proficiencyBonus: 3,
  rageDamage: 2,
  classLevels: { barbarian: 3, fighter: 2 }
};

describe('evaluateValue', () => {
  it('passes numbers and booleans through', () => {
    expect(evaluateValue(42, ctx)).toBe(42);
    expect(evaluateValue(true, ctx)).toBe(true);
  });

  it('resolves the magic identifiers', () => {
    expect(evaluateValue('totalLevel', ctx)).toBe(5);
    expect(evaluateValue('proficiencyBonus', ctx)).toBe(3);
    expect(evaluateValue('rageDamage', ctx)).toBe(2);
  });

  it('passes unknown strings through unchanged (not all strings are magic)', () => {
    expect(evaluateValue('custom', ctx)).toBe('custom');
  });

  // Locks the perClass table contract — barbarian rage uses N-per-day from
  // a class-level table. A regression that off-by-ones the index would
  // silently corrupt every scaling ability.
  it('resolves perClass + table at the right level index', () => {
    const table = { perClass: 'barbarian', table: [2, 3, 4, 4, 5] };
    expect(evaluateValue(table, ctx)).toBe(4); // barbarian L3 → index 2
  });

  it('returns 0 when the class level is 0 (unmulticlassed)', () => {
    const table = { perClass: 'wizard', table: [1, 2, 3] };
    expect(evaluateValue(table, ctx)).toBe(0);
  });

  it('caps the table lookup at the last entry when level exceeds length', () => {
    const table = { perClass: 'fighter', table: [10, 20] };
    // fighter is L2 → index 1 → 20
    expect(evaluateValue(table, ctx)).toBe(20);
    // bump beyond table length
    expect(
      evaluateValue(table, { ...ctx, classLevels: { fighter: 5 } })
    ).toBe(20);
  });
});

describe('proficiencyBonusFor', () => {
  // Locks the 5e proficiency bonus table. Every save / skill / spell DC
  // ultimately reads from this; a regression here is invisible until a
  // user notices their save is off by one.
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6]
  ])('level %i → +%i', (level, bonus) => {
    expect(proficiencyBonusFor(level)).toBe(bonus);
  });
});

describe('abilityModifier', () => {
  it.each([
    [1, -5],
    [8, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [15, 2],
    [20, 5],
    [30, 10]
  ])('score %i → mod %i', (score, mod) => {
    expect(abilityModifier(score)).toBe(mod);
  });
});

describe('rageDamageFor', () => {
  // 2024 rules: rage damage = proficiency bonus. A regression that switches
  // back to the 2014 table would silently change every barbarian's output.
  it('returns the proficiency bonus unmodified', () => {
    const fakeChar = {} as CharacterDocument;
    expect(rageDamageFor(fakeChar, 2)).toBe(2);
    expect(rageDamageFor(fakeChar, 6)).toBe(6);
  });
});
