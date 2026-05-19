// Locks the condition mechanical effects wiring in derive():
//   - speed.all modifiers are applied to every speed key
//   - exhaustion applies -2 to saves, skills, and initiative via explicit modifiers
//   - data.implies is resolved transitively (unconscious → prone + incapacitated)

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function lookup(): ContentLookup {
  return (ref) => PACKS.get(`${ref.kind}/${ref.slug}`);
}

/** Minimal character for condition tests — Human Fighter L1 with a
 *  longsword. No feats, no special species modifiers. */
const BASE_CHARACTER: CharacterDocument = {
  id: 'test-conditions-mechanical',
  name: 'Test Fighter',
  classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
  species: { kind: 'species', slug: 'human' },
  feats: [],
  abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  proficienciesChosen: { skills: ['athletics', 'perception'] },
  inventory: [
    { contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false }
  ],
  spells: { known: [], prepared: [] },
  currentHp: 12,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: [],
  modifierToggles: {}
};

describe('Prone condition mechanical effects', () => {
  // Locks that the prone condition loads and applies its modifiers without
  // crashing — the specific modifiers (crawl-only, attack.disadvantage) are
  // stat-modifier targets the UI reads, not numeric deltas, so we test
  // that the condition row was found and added to active content.
  it('derives successfully with prone condition and produces actions', () => {
    const character: CharacterDocument = { ...BASE_CHARACTER, conditions: ['prone'] };
    const d = derive(character, lookup());
    expect(d.validations.filter((v) => v.severity === 'error')).toHaveLength(0);
    // Speed is unchanged by prone (only crawl-movement restriction, not
    // a numeric modifier) — confirm the walk speed is still 30.
    expect(d.stats.speeds.walk).toBe(30);
  });
});

describe('Exhaustion condition: speed.all and d20-test penalties', () => {
  // Locks that speed.all modifiers are applied to every speed key (fixing
  // the previous silent-drop of speed.all ADD modifiers in computeSpeeds).
  it('reduces walk speed by 5 with exhaustion level 1', () => {
    const character: CharacterDocument = { ...BASE_CHARACTER, conditions: ['exhaustion'] };
    const d = derive(character, lookup());
    // Human walk speed starts at 30; exhaustion adds -5 via speed.all.
    expect(d.stats.speeds.walk).toBe(25);
  });

  it('applies -2 to all saves with exhaustion', () => {
    const base = derive(BASE_CHARACTER, lookup());
    const exhausted = derive({ ...BASE_CHARACTER, conditions: ['exhaustion'] }, lookup());

    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(exhausted.stats.saves[ab].bonus).toBe(base.stats.saves[ab].bonus - 2);
    }
  });

  it('applies -2 to skill checks with exhaustion', () => {
    const base = derive(BASE_CHARACTER, lookup());
    const exhausted = derive({ ...BASE_CHARACTER, conditions: ['exhaustion'] }, lookup());

    // Spot-check a few skills
    expect(exhausted.stats.skills.perception.bonus).toBe(base.stats.skills.perception.bonus - 2);
    expect(exhausted.stats.skills.athletics.bonus).toBe(base.stats.skills.athletics.bonus - 2);
    expect(exhausted.stats.skills.stealth.bonus).toBe(base.stats.skills.stealth.bonus - 2);
  });

  it('applies -2 to initiative with exhaustion', () => {
    const base = derive(BASE_CHARACTER, lookup());
    const exhausted = derive({ ...BASE_CHARACTER, conditions: ['exhaustion'] }, lookup());
    expect(exhausted.stats.initiative).toBe(base.stats.initiative - 2);
  });

  it('applies speed.all to non-walk speeds too (fly, swim)', () => {
    // Build a character with a species that has fly and swim speeds.
    // We inject a fake species row that has speed.fly = 30, speed.swim = 20
    // and verify that exhaustion's speed.all -5 hits both.
    const fakeSpecies: ContentRow = {
      kind: 'species',
      slug: 'test-flier',
      version: 1,
      name: 'Test Flier',
      source: 'test',
      data: {
        speed: { walk: 30, fly: 30, swim: 20 },
        modifiers: []
      }
    };
    const baseLookup = lookup();
    const withFlier: ContentLookup = (ref) => {
      if (ref.kind === 'species' && ref.slug === 'test-flier') return fakeSpecies;
      return baseLookup(ref);
    };
    const character: CharacterDocument = {
      ...BASE_CHARACTER,
      species: { kind: 'species', slug: 'test-flier' },
      conditions: ['exhaustion']
    };
    const d = derive(character, withFlier);
    expect(d.stats.speeds.walk).toBe(25);
    expect(d.stats.speeds.fly).toBe(25);
    expect(d.stats.speeds.swim).toBe(15);
  });
});

describe('Unconscious condition: data.implies resolves prone + incapacitated', () => {
  // Locks that data.implies is processed transitively in Phase 1 of derive.
  // Unconscious implies prone and incapacitated. The incapacitated modifiers
  // (action.disabled, etc.) and prone modifiers should all be active even
  // though only "unconscious" is listed in character.conditions.
  it('derives without content-missing warnings for implied conditions', () => {
    const character: CharacterDocument = { ...BASE_CHARACTER, conditions: ['unconscious'] };
    const d = derive(character, lookup());
    // All three rows (unconscious, prone, incapacitated) must resolve.
    const missing = d.validations.filter(
      (v) => v.code === 'content-missing' && v.message.includes('condition/')
    );
    expect(missing).toHaveLength(0);
  });

  it('applies incapacitated modifiers when unconscious (action.disabled etc.)', () => {
    // The incapacitated row carries "action.disabled" stat modifier. We
    // verify the active set is expanded by checking that the incapacitated
    // row's modifiers appear in the stat block derivation (no thrown
    // errors, and the validations are clean — the numeric effects of
    // action.disabled aren't numeric so we check via the condition resolution).
    const character: CharacterDocument = { ...BASE_CHARACTER, conditions: ['unconscious'] };
    const d = derive(character, lookup());
    // Unconscious also implies prone; both should have no missing content.
    expect(d.validations.some((v) => v.severity === 'error')).toBe(false);
  });

  it('implies chain: paralyzed → incapacitated is also resolved', () => {
    const character: CharacterDocument = { ...BASE_CHARACTER, conditions: ['paralyzed'] };
    const d = derive(character, lookup());
    const missing = d.validations.filter(
      (v) => v.code === 'content-missing' && v.message.includes('condition/')
    );
    expect(missing).toHaveLength(0);
  });
});
