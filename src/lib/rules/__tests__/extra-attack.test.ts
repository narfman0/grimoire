// Locks the Extra Attack feature wiring in derive():
//   - Active feature with extraAttacks: 1 sets attackCount: 2 on weapon attacks
//   - Fighter L5+ with a longsword derives attackCount: 2 on the attack action
//   - Characters without extra-attack have no attackCount (or attackCount 1)

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

/** Fighter L5 with a longsword — should have attackCount: 2 on attack. */
const FIGHTER_L5: CharacterDocument = {
  id: 'test-fighter-l5',
  name: 'Arken Ironforge',
  classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
  species: { kind: 'species', slug: 'human' },
  feats: [],
  abilityScores: { str: 18, dex: 12, con: 16, int: 10, wis: 10, cha: 8 },
  proficienciesChosen: { skills: ['athletics', 'perception'] },
  inventory: [
    { contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false }
  ],
  spells: { known: [], prepared: [] },
  currentHp: 52,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: [],
  modifierToggles: {}
};

/** Fighter L4 — no Extra Attack yet. */
const FIGHTER_L4: CharacterDocument = {
  ...FIGHTER_L5,
  id: 'test-fighter-l4',
  classes: [{ slug: 'fighter', level: 4, hpRolledPerLevel: [10, 6, 6, 6] }]
};

describe('Extra Attack: Fighter L5 with longsword', () => {
  // Locks that a Fighter L5 with a weapon gets attackCount: 2 on the attack
  // action, derived from the extra-attack feature's extraAttacks: 1.
  it('derives attackCount: 2 on the longsword attack action at L5', () => {
    const d = derive(FIGHTER_L5, lookup());
    const attacks = d.actions.filter(
      (a) => a.type === 'attack' && a.cost === 'action'
    );
    expect(attacks.length).toBeGreaterThan(0);
    for (const a of attacks) {
      expect(a.attackCount).toBe(2);
    }
  });

  it('Fighter L4 has no attackCount (or undefined) on weapon attack', () => {
    const d = derive(FIGHTER_L4, lookup());
    const attacks = d.actions.filter(
      (a) => a.type === 'attack' && a.cost === 'action'
    );
    expect(attacks.length).toBeGreaterThan(0);
    for (const a of attacks) {
      // attackCount should be undefined when no extra-attack feature is active
      expect(a.attackCount).toBeUndefined();
    }
  });

  it('produces a longsword attack action with the correct attack bonus', () => {
    const d = derive(FIGHTER_L5, lookup());
    const longsword = d.actions.find(
      (a) => a.type === 'attack' && a.sourceContent.slug === 'longsword'
    );
    expect(longsword).toBeDefined();
    // STR 18 → mod +4, proficiency at L5 = +3, total = +7
    expect(longsword!.attackBonus).toBe(7);
  });
});

describe('Extra Attack: synthetic feature injection', () => {
  // Verifies engine behavior in isolation: a fake feature with extraAttacks: 2
  // should produce attackCount: 3 on attack actions.
  it('sets attackCount: 3 when a feature grants extraAttacks: 2', () => {
    const fakeFeature: ContentRow = {
      kind: 'feature',
      slug: 'triple-strike',
      version: 1,
      name: 'Triple Strike',
      source: 'test',
      data: { extraAttacks: 2, modifiers: [] }
    };
    const baseLookup = lookup();
    const withFeature: ContentLookup = (ref) => {
      if (ref.kind === 'feature' && ref.slug === 'triple-strike') return fakeFeature;
      return baseLookup(ref);
    };
    // Inject via a fake species that grants the feature
    const fakeSpecies: ContentRow = {
      kind: 'species',
      slug: 'test-warrior',
      version: 1,
      name: 'Test Warrior',
      source: 'test',
      data: {
        speed: { walk: 30 },
        modifiers: [],
        features: ['triple-strike']
      }
    };
    const withAll: ContentLookup = (ref) => {
      if (ref.kind === 'species' && ref.slug === 'test-warrior') return fakeSpecies;
      if (ref.kind === 'feature' && ref.slug === 'triple-strike') return fakeFeature;
      return baseLookup(ref);
    };
    const character: CharacterDocument = {
      ...FIGHTER_L4,
      id: 'test-triple',
      species: { kind: 'species', slug: 'test-warrior' }
    };
    const d = derive(character, withAll);
    const attacks = d.actions.filter((a) => a.type === 'attack' && a.cost === 'action');
    expect(attacks.length).toBeGreaterThan(0);
    for (const a of attacks) {
      expect(a.attackCount).toBe(3);
    }
  });
});
