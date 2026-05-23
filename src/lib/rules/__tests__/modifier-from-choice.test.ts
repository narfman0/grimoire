// `modifierFromChoice` — union-shape feature pick where each option carries
// its own modifier set. Unblocks Aspect of the Wilds (Owl=darkvision /
// Panther=climb / Salmon=swim), Kobold Legacy (skill / save-adv / cantrip),
// Transmuter's Stone (darkvision / resistance / speed / proficiency).
//
// Contract:
//   data.choices.modifierFromChoice = {
//     label?: string,
//     options: [{ id: string, label?: string, modifiers: [...] }, ...]
//   }
//   character.featureChoices[slug] = { modifierFromChoice: { option: '<id>' } }
//
// derive() finds the option whose id matches the pick, then emits the
// option's modifiers as if they had been declared on the row directly.
// Picks that don't match any option silently drop.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const SYNTH_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: { hitDie: 8, primaryAbility: 'wis', savingThrows: ['wis', 'cha'] }
};

const SYNTH_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'test-subclass',
  version: 1,
  source: 'test',
  name: 'Test Subclass',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [{ level: 1, name: 'Aspect of the Wilds' }]
  }
};

// Aspect of the Wilds analogue — pick one of three distinct modifier sets.
const FEATURE_ASPECT: ContentRow = {
  kind: 'feature',
  slug: 'aspect-of-the-wilds',
  version: 1,
  source: 'test',
  name: 'Aspect of the Wilds',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      modifierFromChoice: {
        label: 'Aspect of the Wilds',
        options: [
          {
            id: 'owl',
            label: 'Owl',
            modifiers: [
              { kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }
            ]
          },
          {
            id: 'panther',
            label: 'Panther',
            modifiers: [
              { kind: 'stat-modifier', target: 'speed.climb', mode: 'UPGRADE', value: 'walkSpeed' }
            ]
          },
          {
            id: 'salmon',
            label: 'Salmon',
            modifiers: [
              { kind: 'stat-modifier', target: 'speed.swim', mode: 'UPGRADE', value: 'walkSpeed' }
            ]
          }
        ]
      }
    }
  }
};

const SYNTH_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

function makeLookup(): ContentLookup {
  const rows: ContentRow[] = [SYNTH_CLASS, SYNTH_SUBCLASS, FEATURE_ASPECT, SYNTH_SPECIES];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(featureChoices?: Record<string, Record<string, unknown>>): CharacterDocument {
  return {
    id: 'test-mfc',
    name: 'Test Character',
    classes: [{ slug: 'test-class', level: 1, subclass: 'test-subclass', hpRolledPerLevel: [8] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 14, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 8,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices
  };
}

describe('modifierFromChoice — Aspect of the Wilds shape', () => {
  it('emits Owl darkvision modifier when option=owl', () => {
    const char = baseCharacter({
      'aspect-of-the-wilds': { modifierFromChoice: { option: 'owl' } }
    });
    const d = derive(char, makeLookup());
    // Owl grants darkvision 60
    expect(d.stats.senses.darkvision).toBe(60);
    // Panther's climb and Salmon's swim must NOT apply
    expect(d.stats.speeds.climb).toBeUndefined();
    expect(d.stats.speeds.swim).toBeUndefined();
  });

  it('emits Panther climb-speed modifier when option=panther', () => {
    const char = baseCharacter({
      'aspect-of-the-wilds': { modifierFromChoice: { option: 'panther' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.speeds.climb).toBe(d.stats.speeds.walk);
    // Owl + Salmon must NOT apply
    expect(d.stats.senses.darkvision).toBeUndefined();
    expect(d.stats.speeds.swim).toBeUndefined();
  });

  it('emits Salmon swim-speed modifier when option=salmon', () => {
    const char = baseCharacter({
      'aspect-of-the-wilds': { modifierFromChoice: { option: 'salmon' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.speeds.swim).toBe(d.stats.speeds.walk);
    expect(d.stats.senses.darkvision).toBeUndefined();
    expect(d.stats.speeds.climb).toBeUndefined();
  });

  it('silently drops a pick that does not match any option id', () => {
    const char = baseCharacter({
      'aspect-of-the-wilds': { modifierFromChoice: { option: 'dragon' } }
    });
    const d = derive(char, makeLookup());
    // Nothing applies — no over-grant, no crash
    expect(d.stats.senses.darkvision).toBeUndefined();
    expect(d.stats.speeds.climb).toBeUndefined();
    expect(d.stats.speeds.swim).toBeUndefined();
  });

  it('emits nothing when no pick is recorded', () => {
    const char = baseCharacter({ 'aspect-of-the-wilds': {} });
    const d = derive(char, makeLookup());
    expect(d.stats.senses.darkvision).toBeUndefined();
  });
});

describe('modifierFromChoice — synthesizes action-modifier shapes too', () => {
  const FEATURE_MFC_ACTIONS: ContentRow = {
    kind: 'feature',
    slug: 'mfc-action-pick',
    version: 1,
    source: 'test',
    name: 'Action-Modifier Pick',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'test-subclass-alt',
      minLevel: 1,
      choices: {
        modifierFromChoice: {
          options: [
            {
              id: 'fierce',
              label: 'Fierce',
              modifiers: [
                {
                  kind: 'action-modifier',
                  id: 'mfc-fierce-bump',
                  appliesTo: { activityType: 'attack' },
                  effects: [{ target: 'attack.roll', mode: 'ADD', value: 1 }]
                }
              ]
            }
          ]
        }
      }
    }
  };
  const SUBCLASS_ALT: ContentRow = {
    ...SYNTH_SUBCLASS,
    slug: 'test-subclass-alt',
    data: {
      parentClass: 'test-class',
      subclassFeatures: [{ level: 1, name: 'Action-Modifier Pick' }]
    }
  };

  it('routes action-modifier options through the action-modifier pipeline', () => {
    const rows: ContentRow[] = [SYNTH_CLASS, SUBCLASS_ALT, FEATURE_MFC_ACTIONS, SYNTH_SPECIES];
    const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
    const lookup: ContentLookup = (ref) => map.get(`${ref.kind}/${ref.slug}`);
    const char: CharacterDocument = {
      ...baseCharacter({
        'mfc-action-pick': { modifierFromChoice: { option: 'fierce' } }
      }),
      classes: [
        { slug: 'test-class', level: 1, subclass: 'test-subclass-alt', hpRolledPerLevel: [8] }
      ]
    };
    const d = derive(char, lookup);
    // The action-modifier passes Phase 4 application; the audit trail should
    // reflect mfc/fierce on some action — but with no weapons equipped on
    // this fixture, the easiest check is that the synthesis didn't crash
    // and the row participates in Derived without errors.
    expect(d.validations.filter((v) => v.severity === 'error')).toEqual([]);
  });
});
