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
  classLevels: { barbarian: 3, fighter: 2 },
  abilityMods: { str: 1, dex: 2, con: 3, int: 4, wis: -1, cha: 0 },
  walkSpeed: 30,
  conditionStacks: { exhaustion: 2 }
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

  // Locks the C.0 token expansion. Before this landed, every `intMod` /
  // `wisMod` / `<class>Level` reference in a modifier silently no-op'd —
  // the row evaluated to the bare string, which then fell through
  // applyNumericMode as zero. ~30 P0 pack rows depended on this.
  it('resolves ability-mod tokens against ctx.abilityMods', () => {
    expect(evaluateValue('strMod', ctx)).toBe(1);
    expect(evaluateValue('dexMod', ctx)).toBe(2);
    expect(evaluateValue('conMod', ctx)).toBe(3);
    expect(evaluateValue('intMod', ctx)).toBe(4);
    expect(evaluateValue('wisMod', ctx)).toBe(-1);
    expect(evaluateValue('chaMod', ctx)).toBe(0);
  });

  it('resolves walkSpeed against ctx.walkSpeed', () => {
    expect(evaluateValue('walkSpeed', ctx)).toBe(30);
  });

  it('resolves <class>Level tokens against ctx.classLevels', () => {
    expect(evaluateValue('barbarianLevel', ctx)).toBe(3);
    expect(evaluateValue('fighterLevel', ctx)).toBe(2);
  });

  it('returns 0 for <class>Level when the character has no levels in that class', () => {
    expect(evaluateValue('wizardLevel', ctx)).toBe(0);
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

  // Locks the perConditionStack evaluator contract — exhaustion uses this to
  // compute stacking -2 per level penalties. A regression would silently apply
  // the wrong penalty or drop it entirely.
  it('resolves perConditionStack × perLevel correctly', () => {
    const formula = { perConditionStack: 'exhaustion', perLevel: -2 };
    // ctx has conditionStacks.exhaustion = 2 → 2 * -2 = -4
    expect(evaluateValue(formula, ctx)).toBe(-4);
  });

  it('returns 0 for perConditionStack when the condition is not stacked', () => {
    const formula = { perConditionStack: 'frightened', perLevel: -2 };
    // frightened not in conditionStacks → 0 * -2 = 0
    expect(evaluateValue(formula, ctx)).toBe(0);
  });

  it('resolves perConditionStack speed penalty', () => {
    const formula = { perConditionStack: 'exhaustion', perLevel: -5 };
    // conditionStacks.exhaustion = 2 → 2 * -5 = -10
    expect(evaluateValue(formula, ctx)).toBe(-10);
  });
});

// Locks the small arithmetic grammar Phase 1a added on top of token
// resolution. Without these, formulas like "1 + warlockLevel" or
// "floor(barbarianLevel/2)" silently fell through as raw strings and
// applyNumericMode treated them as zero — corrupting Lay on Hands,
// Healing Light, Divine Fury rider, Bardic Inspiration scaling, etc.
describe('evaluateValue: arithmetic expressions', () => {
  it('adds a literal to a class-level token', () => {
    // warlockLevel = 0 (not in classLevels) → 1 + 0 = 1
    expect(evaluateValue('1 + warlockLevel', ctx)).toBe(1);
    expect(evaluateValue('1 + barbarianLevel', ctx)).toBe(4);
  });

  it('multiplies a class-level token by a literal (Lay on Hands shape)', () => {
    expect(evaluateValue('barbarianLevel * 5', ctx)).toBe(15);
    expect(evaluateValue('paladinLevel * 5', ctx)).toBe(0);
  });

  it('floors integer division (half-level rider shape)', () => {
    expect(evaluateValue('floor(barbarianLevel/2)', ctx)).toBe(1);
    // total-level half
    expect(evaluateValue('floor(totalLevel/2)', ctx)).toBe(2);
  });

  it('takes the max of a literal and an ability mod', () => {
    expect(evaluateValue('max(1, intMod)', ctx)).toBe(4);
    // wisMod is -1 → max(1, -1) = 1
    expect(evaluateValue('max(1, wisMod)', ctx)).toBe(1);
  });

  it('honors precedence: * before +', () => {
    expect(evaluateValue('1 + 2 * 3', ctx)).toBe(7);
  });

  it('honors parens', () => {
    expect(evaluateValue('(1 + 2) * 3', ctx)).toBe(9);
  });

  it('handles unary minus', () => {
    expect(evaluateValue('-intMod', ctx)).toBe(-4);
    expect(evaluateValue('1 + -2', ctx)).toBe(-1);
  });

  it('handles min and ceil', () => {
    expect(evaluateValue('min(barbarianLevel, fighterLevel)', ctx)).toBe(2);
    expect(evaluateValue('ceil(intMod/3)', ctx)).toBe(2);
  });

  it('combines tokens compositionally (sum-of-classes minus literal)', () => {
    // barbarianLevel + fighterLevel - 1 = 3 + 2 - 1 = 4
    expect(evaluateValue('barbarianLevel + fighterLevel - 1', ctx)).toBe(4);
  });

  it('falls back to passthrough on malformed expressions', () => {
    // unbalanced paren
    expect(evaluateValue('floor(intMod', ctx)).toBe('floor(intMod');
    // unknown function — call site fails → null → passthrough
    expect(evaluateValue('bogus(1)', ctx)).toBe('bogus(1)');
    // bare unknown identifier inside arithmetic
    expect(evaluateValue('1 + mysteryToken', ctx)).toBe('1 + mysteryToken');
  });

  it('does not parse strings that look like simple words (no operators)', () => {
    // Already covered by passthrough test above but lock the boundary:
    // arithmetic only triggers when an operator/paren char is present.
    expect(evaluateValue('hello', ctx)).toBe('hello');
  });

  it('treats divide-by-zero as a parse failure (passthrough)', () => {
    expect(evaluateValue('1 / 0', ctx)).toBe('1 / 0');
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
