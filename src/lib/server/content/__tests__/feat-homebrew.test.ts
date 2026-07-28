// Unit tests for the homebrew feat validation schemas. The derive-engine
// integration is covered in src/lib/rules/__tests__/homebrew-feat.test.ts —
// these are pure zod shape checks.

import { describe, it, expect } from 'vitest';
import {
  FeatDataSchema,
  FeatHomebrewCreate,
  StatModifierSchema
} from '../schemas';

describe('FeatDataSchema', () => {
  it('accepts an empty data object', () => {
    expect(FeatDataSchema.safeParse({}).success).toBe(true);
  });

  it('accepts the canonical Alert shape (modifiers only)', () => {
    const data = {
      category: 'Origin',
      modifiers: [
        { kind: 'stat-modifier' as const, target: 'initiative', mode: 'ADD' as const, value: 'proficiencyBonus' }
      ]
    };
    expect(FeatDataSchema.safeParse(data).success).toBe(true);
  });

  it('accepts every choice slot derive() consumes', () => {
    const data = {
      choices: {
        asi: { bonus: 1, allowedAbilities: ['str', 'dex'] },
        skillProficiency: { allowedSkills: ['athletics'] },
        expertise: { allowedSkills: 'proficient' },
        savingThrow: { allowedAbilities: ['con'] },
        language: { allowedLanguages: ['elvish'] },
        toolProficiency: { allowedTools: ['thieves-tools'] },
        spell: { picks: 2, level: 1, allowedSpells: ['magic-missile'] },
        feature: { allowedFeatures: ['rage-strong'], category: 'rage' }
      }
    };
    const r = FeatDataSchema.safeParse(data);
    expect(r.success).toBe(true);
  });

  it('rejects an unknown ability key', () => {
    const r = FeatDataSchema.safeParse({
      choices: { asi: { allowedAbilities: ['nope'] } }
    });
    expect(r.success).toBe(false);
  });

  it('passes through unknown top-level keys (pack import compat)', () => {
    const r = FeatDataSchema.safeParse({ randomField: 1 });
    expect(r.success).toBe(true);
  });

  it('expertise allowedSkills accepts the "proficient" literal', () => {
    const r = FeatDataSchema.safeParse({
      choices: { expertise: { allowedSkills: 'proficient' } }
    });
    expect(r.success).toBe(true);
  });
});

describe('StatModifierSchema', () => {
  it('requires target', () => {
    expect(StatModifierSchema.safeParse({ kind: 'stat-modifier', value: 1 }).success).toBe(false);
  });

  it('accepts string values (e.g. proficiencyBonus)', () => {
    expect(
      StatModifierSchema.safeParse({
        kind: 'stat-modifier',
        target: 'initiative',
        mode: 'ADD',
        value: 'proficiencyBonus'
      }).success
    ).toBe(true);
  });

  // Regression (engine batch 6 §1): `value` used to be scalar-only, so an
  // object-valued modifier — the `ac.formula` literal, and every
  // evaluateValue object shape — was rejected on any row validated through
  // this schema (feats + items). XGtE Dragon Hide and PHB-2014 Medium
  // Armor Master were blocked on exactly this.
  it('accepts an object-valued ac.formula (Dragon Hide unarmored AC)', () => {
    const r = StatModifierSchema.safeParse({
      kind: 'stat-modifier',
      target: 'ac.formula',
      mode: 'OVERRIDE',
      value: { base: 13, ability: 'dex' }
    });
    expect(r.success).toBe(true);
    // passthrough keeps every key — the engine, not zod, is the authority
    // on which fields a target reads.
    expect(r.data!.value).toEqual({ base: 13, ability: 'dex' });
  });

  it('accepts the evaluateValue object shapes', () => {
    for (const value of [
      { perClass: 'barbarian', table: [2, 2, 3] },
      { perTotalLevel: true, table: ['1d6', '2d6'] },
      { perConditionStack: 'exhaustion', perLevel: -2 },
      { sum: ['warlockLevel', 'chaMod'] },
      { perAbilityMod: 'wis', dieSize: 8 },
      { perClassLevel: 'cleric', multiplier: 5 }
    ]) {
      const r = StatModifierSchema.safeParse({
        kind: 'stat-modifier',
        target: 'hp.max',
        value
      });
      expect(r.success, JSON.stringify(value)).toBe(true);
      expect(r.data!.value).toEqual(value);
    }
  });

  // Regression (engine batch 7): the schema stripped every sibling key,
  // so a feat / item stat-modifier lost `appliesWhen`, `sourcePredicate`,
  // `qualifier` and `defaultEnabled` on its way through /api/homebrew —
  // which persists the parsed body. The engine reads all four.
  it('keeps engine-read sibling fields instead of stripping them', () => {
    const r = StatModifierSchema.safeParse({
      kind: 'stat-modifier',
      name: 'Mantle of Spell Resistance',
      target: 'save.advantage.all',
      value: true,
      sourcePredicate: { kind: 'spell' },
      qualifier: 'nonmagical',
      defaultEnabled: false,
      appliesWhen: { condition: 'raging', circumstances: ['hp.below-half'] }
    });
    expect(r.success).toBe(true);
    const data = r.data as Record<string, unknown>;
    expect(data.sourcePredicate).toEqual({ kind: 'spell' });
    expect(data.qualifier).toBe('nonmagical');
    expect(data.defaultEnabled).toBe(false);
    expect(data.appliesWhen).toEqual({ condition: 'raging', circumstances: ['hp.below-half'] });
    expect(data.name).toBe('Mantle of Spell Resistance');
  });

  it('still rejects an array value', () => {
    expect(
      StatModifierSchema.safeParse({ kind: 'stat-modifier', target: 'ac', value: [1, 2] }).success
    ).toBe(false);
  });
});

describe('FeatDataSchema — object-valued modifiers', () => {
  it('accepts a feat row carrying an ac.formula OVERRIDE', () => {
    const r = FeatDataSchema.safeParse({
      category: 'General',
      modifiers: [
        { kind: 'stat-modifier', target: 'ac.formula', mode: 'OVERRIDE', value: { base: 13, ability: 'dex' } }
      ]
    });
    expect(r.success).toBe(true);
  });
});

describe('FeatHomebrewCreate', () => {
  it('requires slug, name, data', () => {
    expect(FeatHomebrewCreate.safeParse({ slug: 'x', name: 'X', data: {} }).success).toBe(true);
    expect(FeatHomebrewCreate.safeParse({ slug: 'x', name: 'X' }).success).toBe(false);
  });

  it('rejects bad slug (uppercase)', () => {
    expect(FeatHomebrewCreate.safeParse({ slug: 'BadSlug', name: 'X', data: {} }).success).toBe(false);
  });
});
