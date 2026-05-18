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

  it('rejects an unknown top-level key', () => {
    const r = FeatDataSchema.safeParse({ randomField: 1 });
    expect(r.success).toBe(false);
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
