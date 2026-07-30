import { describe, it, expect } from 'vitest';
import { ABILITY_LABEL, parseSaveFromProse, saveForAction } from '../save-prose';

describe('parseSaveFromProse', () => {
  it('parses the printed "DC N Ability saving throw" phrasing', () => {
    expect(
      parseSaveFromProse(
        'Each creature in a 15-foot cone must make a DC 15 Dexterity saving throw, taking 24 fire damage on a failed save, or half as much on a successful one.'
      )
    ).toEqual({ dc: 15, ability: 'dex' });
  });

  it('parses the reversed "Ability saving throw (DC N)" phrasing', () => {
    expect(parseSaveFromProse('The target must succeed on a Constitution saving throw (DC 13).')).toEqual(
      { dc: 13, ability: 'con' }
    );
  });

  it('handles abbreviations and casing', () => {
    expect(parseSaveFromProse('dc 11 wis saving throw')).toEqual({ dc: 11, ability: 'wis' });
  });

  it('takes the DC without an ability when the prose names none', () => {
    expect(parseSaveFromProse('must make a saving throw, DC 17, or be stunned')).toEqual({
      dc: 17,
      ability: null
    });
  });

  it('takes the first save of a multi-clause description', () => {
    expect(
      parseSaveFromProse(
        'DC 15 Dexterity saving throw for half damage, then a DC 13 Constitution saving throw against being poisoned.'
      )
    ).toEqual({ dc: 15, ability: 'dex' });
  });

  it('ignores a DC that is not about a saving throw', () => {
    expect(parseSaveFromProse('The lock has a DC 20 Dexterity check to pick.')).toBeNull();
    expect(parseSaveFromProse('Spell save DC is listed in the header.')).toBeNull();
  });

  it('returns null for prose with no DC, and for nothing at all', () => {
    expect(parseSaveFromProse('Melee Weapon Attack: +4 to hit, reach 5 ft.')).toBeNull();
    expect(parseSaveFromProse('')).toBeNull();
    expect(parseSaveFromProse(null)).toBeNull();
    expect(parseSaveFromProse(undefined)).toBeNull();
  });

  it('does not mistake an unknown ability word for one it knows', () => {
    expect(parseSaveFromProse('DC 12 Sanity saving throw')).toEqual({ dc: 12, ability: null });
  });
});

describe('saveForAction', () => {
  it('prefers explicit structured fields over the prose', () => {
    expect(
      saveForAction({
        saveDC: 18,
        saveAbility: 'Wisdom',
        description: 'must make a DC 15 Dexterity saving throw'
      })
    ).toEqual({ dc: 18, ability: 'wis' });
  });

  it('falls back to the prose when only a description is present', () => {
    expect(saveForAction({ description: 'DC 14 Strength saving throw' })).toEqual({
      dc: 14,
      ability: 'str'
    });
  });

  it('takes a structured DC with no ability', () => {
    expect(saveForAction({ saveDC: 16 })).toEqual({ dc: 16, ability: null });
  });

  it('floors a non-integer DC and ignores a non-finite one', () => {
    expect(saveForAction({ saveDC: 15.7 })?.dc).toBe(15);
    expect(saveForAction({ saveDC: Number.NaN, description: 'no save here' })).toBeNull();
  });

  it('returns null for a plain attack and for no action', () => {
    expect(saveForAction({ description: 'Melee Weapon Attack: +7 to hit.' })).toBeNull();
    expect(saveForAction(null)).toBeNull();
    expect(saveForAction(undefined)).toBeNull();
  });
});

describe('ABILITY_LABEL', () => {
  it('labels all six abilities', () => {
    expect(Object.keys(ABILITY_LABEL)).toHaveLength(6);
    expect(ABILITY_LABEL.dex).toBe('DEX');
  });
});
