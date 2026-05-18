// Zod-shape tests for the new structured Spell/Item/Monster homebrew
// schemas. Pure validation; round-trip + passthrough verification.

import { describe, it, expect } from 'vitest';
import {
  SpellDataSchema,
  ItemDataSchema,
  MonsterDataSchema,
  homebrewSchemaFor
} from '../schemas';

describe('SpellDataSchema', () => {
  it('accepts an empty data object', () => {
    expect(SpellDataSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a canonical SRD-shaped cantrip', () => {
    const data = {
      level: 0,
      school: 'evocation',
      castingTime: '1 action',
      range: { value: 120, units: 'feet' },
      components: { verbal: true, somatic: true },
      duration: 'Instantaneous',
      description: 'Pew pew',
      activities: [{ id: 'attack', type: 'attack', name: 'Fire bolt' }]
    };
    expect(SpellDataSchema.safeParse(data).success).toBe(true);
  });

  it('passes through unknown extras (forward-compat)', () => {
    const parsed = SpellDataSchema.parse({ level: 1, srdId: 'fireball', extras: { tag: 'x' } });
    expect((parsed as Record<string, unknown>).srdId).toBe('fireball');
  });

  it('rejects level outside 0..9', () => {
    expect(SpellDataSchema.safeParse({ level: 10 }).success).toBe(false);
    expect(SpellDataSchema.safeParse({ level: -1 }).success).toBe(false);
  });
});

describe('ItemDataSchema', () => {
  it('accepts the canonical SRD-shaped wondrous item', () => {
    const data = {
      category: 'wondrous',
      rarity: 'rare',
      requiresAttunement: true,
      weight: 1.5,
      slot: 'head',
      description: 'Glows softly.',
      modifiers: [
        { kind: 'stat-modifier' as const, target: 'ac', mode: 'ADD' as const, value: 1 }
      ]
    };
    expect(ItemDataSchema.safeParse(data).success).toBe(true);
  });

  it('rejects an unknown rarity', () => {
    expect(ItemDataSchema.safeParse({ rarity: 'bespoke' }).success).toBe(false);
  });

  it('accepts the SRD "common" rarity', () => {
    expect(ItemDataSchema.safeParse({ rarity: 'common' }).success).toBe(true);
  });
});

describe('MonsterDataSchema', () => {
  it('accepts a minimal stat block', () => {
    const data = {
      size: 'medium',
      type: 'humanoid',
      alignment: 'neutral',
      ac: 14,
      hp: { max: 22, formula: '4d8+4' },
      speed: { walk: 30 },
      abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 13, cha: 10 },
      cr: '1/4',
      xp: 50
    };
    expect(MonsterDataSchema.safeParse(data).success).toBe(true);
  });

  it('accepts traits and actions as JSON arrays', () => {
    const r = MonsterDataSchema.safeParse({
      traits: [{ name: 'Pack Tactics', text: '…' }],
      actions: [{ name: 'Bite', attack: '+4', damage: '1d4+2' }]
    });
    expect(r.success).toBe(true);
  });

  it('accepts the SRD-shaped CR as a number too', () => {
    expect(MonsterDataSchema.safeParse({ cr: 2 }).success).toBe(true);
  });

  it('rejects an unknown size', () => {
    expect(MonsterDataSchema.safeParse({ size: 'colossal' }).success).toBe(false);
  });
});

describe('HOMEBREW_DATA_SCHEMAS registry', () => {
  it('wires the structured schemas for spell/item/monster', () => {
    expect(homebrewSchemaFor('spell')).toBe(SpellDataSchema);
    expect(homebrewSchemaFor('item')).toBe(ItemDataSchema);
    expect(homebrewSchemaFor('monster')).toBe(MonsterDataSchema);
  });

  it('still falls through to permissive for kinds without a structured editor', () => {
    const s = homebrewSchemaFor('background');
    // Permissive: accepts any object including unknown keys.
    expect(s).toBeDefined();
    expect(s!.safeParse({ arbitrary: 'shape', n: 1 }).success).toBe(true);
  });
});
