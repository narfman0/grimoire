// Downtime cost declarations (`data.downtime` → `Derived.downtimeEffects`).
//
// The 2014 wizard Savant features halve the gold AND time to copy their
// school's spells into the spellbook. That is a real rule with no engine
// target — and no simulator is warranted, so the capability is a
// declaration the sheet renders beside the feature.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const TEST_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-wizard',
  version: 1,
  source: 'test',
  name: 'Test Wizard',
  data: {
    hitDie: 6,
    primaryAbility: 'int',
    savingThrows: ['int', 'wis'],
    features: ['abjuration-savant']
  }
};

const TEST_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

function savant(downtime: unknown): ContentRow {
  return {
    kind: 'feature',
    slug: 'abjuration-savant',
    version: 1,
    source: 'test',
    name: 'Abjuration Savant',
    data: { ownerKind: 'class', ownerSlug: 'test-wizard', minLevel: 1, downtime }
  };
}

function makeLookup(rows: ContentRow[]): ContentLookup {
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function character(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'downtime-test',
    name: 'Test Wizard',
    classes: [{ slug: 'test-wizard', level: 5, hpRolledPerLevel: [6, 4, 4, 4, 4] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 12, con: 12, int: 18, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 24,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

function deriveWith(downtime: unknown) {
  return derive(character(), makeLookup([TEST_CLASS, TEST_SPECIES, savant(downtime)]));
}

describe('downtime cost declarations', () => {
  it('surfaces the Savant halved gold + time with source attribution', () => {
    const d = deriveWith({
      activity: 'copy-spell',
      goldMultiplier: 0.5,
      timeMultiplier: 0.5,
      scope: 'Abjuration spells'
    });
    expect(d.downtimeEffects).toEqual([
      {
        sourceContent: { kind: 'feature', slug: 'abjuration-savant' },
        name: 'Abjuration Savant',
        activity: 'copy-spell',
        goldMultiplier: 0.5,
        timeMultiplier: 0.5,
        scope: 'Abjuration spells'
      }
    ]);
  });

  it('accepts an array of declarations and a flat gold delta', () => {
    const d = deriveWith([
      { activity: 'copy-spell', goldMultiplier: 0.5 },
      { activity: 'craft-item', goldDelta: -50, name: 'Bulk discount', description: 'per item' }
    ]);
    expect(d.downtimeEffects).toHaveLength(2);
    expect(d.downtimeEffects![1]).toEqual({
      sourceContent: { kind: 'feature', slug: 'abjuration-savant' },
      name: 'Bulk discount',
      activity: 'craft-item',
      goldDelta: -50,
      description: 'per item'
    });
  });

  it('drops entries with no activity and malformed multipliers', () => {
    const d = deriveWith([
      { goldMultiplier: 0.5 },
      { activity: '' },
      { activity: 'research', goldMultiplier: 'half', timeMultiplier: -1 }
    ]);
    expect(d.downtimeEffects).toEqual([
      {
        sourceContent: { kind: 'feature', slug: 'abjuration-savant' },
        name: 'Abjuration Savant',
        activity: 'research'
      }
    ]);
  });

  it('omits the manifest entirely when nothing is declared', () => {
    expect(deriveWith(undefined).downtimeEffects).toBeUndefined();
    expect(deriveWith({}).downtimeEffects).toBeUndefined();
  });

  it('honors the item attunement gate on an item-sourced declaration', () => {
    const ring: ContentRow = {
      kind: 'item',
      slug: 'test-scribes-ring',
      version: 1,
      source: 'test',
      name: "Scribe's Ring",
      data: {
        category: 'wondrous',
        requiresAttunement: true,
        downtime: { activity: 'scribe-scroll', timeMultiplier: 0.5 }
      }
    };
    const lookup = makeLookup([TEST_CLASS, TEST_SPECIES, savant(undefined), ring]);
    const slot = (attuned: boolean) => [
      { contentKind: 'item', contentSlug: 'test-scribes-ring', version: 1, equipped: true, attuned }
    ];
    expect(derive(character({ inventory: slot(false) }), lookup).downtimeEffects).toBeUndefined();
    expect(derive(character({ inventory: slot(true) }), lookup).downtimeEffects).toHaveLength(1);
  });
});
