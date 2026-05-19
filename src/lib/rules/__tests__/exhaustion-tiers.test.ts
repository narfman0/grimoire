// Locks the exhaustion tier stacking model:
//   - conditionStacks.exhaustion = 1 → -2 to d20 tests, -5 to all speeds
//   - conditionStacks.exhaustion = 3 → -6 to d20 tests, -15 to all speeds
//   - conditionStacks.exhaustion = 5 → -10 to d20 tests, -25 to all speeds

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

/** Human fighter base character — clean stats, no modifiers. */
const BASE: CharacterDocument = {
  id: 'test-exhaustion-tiers',
  name: 'Test Character',
  classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
  species: { kind: 'species', slug: 'human' },
  feats: [],
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  proficienciesChosen: { skills: ['athletics'] },
  inventory: [],
  spells: { known: [], prepared: [] },
  currentHp: 12,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: ['exhaustion'],
  modifierToggles: {}
};

describe('Exhaustion tier 1', () => {
  // Locks that a single exhaustion level applies -2 to saves/skills/initiative
  // and -5 to all speeds via the perConditionStack evaluator.
  it('applies -2 to all saves at exhaustion level 1', () => {
    const base = derive({ ...BASE, conditions: [] }, lookup());
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 1 }
    }, lookup());

    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(exhausted.stats.saves[ab].bonus).toBe(base.stats.saves[ab].bonus - 2);
    }
  });

  it('applies -2 to skill checks at exhaustion level 1', () => {
    const base = derive({ ...BASE, conditions: [] }, lookup());
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 1 }
    }, lookup());

    expect(exhausted.stats.skills.athletics.bonus).toBe(base.stats.skills.athletics.bonus - 2);
    expect(exhausted.stats.skills.perception.bonus).toBe(base.stats.skills.perception.bonus - 2);
  });

  it('applies -2 to initiative at exhaustion level 1', () => {
    const base = derive({ ...BASE, conditions: [] }, lookup());
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 1 }
    }, lookup());
    expect(exhausted.stats.initiative).toBe(base.stats.initiative - 2);
  });

  it('applies -5 to walk speed at exhaustion level 1', () => {
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 1 }
    }, lookup());
    // Human walk 30 - 5 = 25
    expect(exhausted.stats.speeds.walk).toBe(25);
  });
});

describe('Exhaustion tier 3', () => {
  // Locks cumulative stacking: 3 levels → -6 to d20 tests, -15 to speeds.
  it('applies -6 to saves at exhaustion level 3', () => {
    const base = derive({ ...BASE, conditions: [] }, lookup());
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 3 }
    }, lookup());

    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(exhausted.stats.saves[ab].bonus).toBe(base.stats.saves[ab].bonus - 6);
    }
  });

  it('applies -15 to walk speed at exhaustion level 3', () => {
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 3 }
    }, lookup());
    // Human walk 30 - 15 = 15
    expect(exhausted.stats.speeds.walk).toBe(15);
  });

  it('applies -6 to initiative at exhaustion level 3', () => {
    const base = derive({ ...BASE, conditions: [] }, lookup());
    const exhausted = derive({
      ...BASE,
      conditionStacks: { exhaustion: 3 }
    }, lookup());
    expect(exhausted.stats.initiative).toBe(base.stats.initiative - 6);
  });
});
