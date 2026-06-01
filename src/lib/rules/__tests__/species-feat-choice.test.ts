// Engine support for choices.feat on species rows (Custom Lineage).
// When a species declares data.choices.feat, the engine:
//   (a) surfaces an unresolved pendingFeatureChoices entry when no pick is recorded
//   (b) defers-loads the chosen feat row so its modifiers/activities apply
//   (c) synthesises the ASI from choices.asi on the same species row alongside the feat

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function makeLookup(extras: Record<string, ContentRow> = {}) {
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? PACKS.get(`${ref.kind}/${ref.slug}`);
}

const BASE_CHAR: CharacterDocument = {
  id: 'fixture-custom-lineage',
  name: 'Test Character',
  classes: [{ slug: 'barbarian', level: 1, hpRolledPerLevel: [12] }],
  species: { kind: 'species', slug: 'custom-lineage', version: 2 },
  feats: [],
  abilityScores: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 8 },
  proficienciesChosen: {},
  inventory: [],
  spells: { known: [], prepared: [] },
  currentHp: 14,
  tempHp: 0 as const,
  hitDiceSpent: {},
  conditions: [],
  modifierToggles: {}
};

// Elven Scorn is a reach+melee weapon (extras fixture); equipping it lets
// the Polearm Master action-modifier fire on its attack action.
const WITH_ELVEN_SCORN: CharacterDocument = {
  ...BASE_CHAR,
  inventory: [
    { contentKind: 'item', contentSlug: 'elven-scorn', version: 1, equipped: true, attuned: true }
  ]
};

describe('Custom Lineage — choices.feat engine support', () => {
  it('surfaces an unresolved pendingFeatureChoices entry when no feat pick recorded', () => {
    const d = derive(BASE_CHAR, makeLookup());

    const speciesEntry = d.pendingFeatureChoices.find(
      (e) => e.kind === 'species' && e.featureSlug === 'custom-lineage'
    );
    expect(speciesEntry).toBeDefined();
    expect(speciesEntry!.unresolved).toBe(true);
    expect(speciesEntry!.declarations).toHaveProperty('feat');
  });

  it('marks the species entry fully resolved when all picks are provided', () => {
    const char: CharacterDocument = {
      ...BASE_CHAR,
      species: {
        ...BASE_CHAR.species,
        choices: {
          asi: { ability: 'str' },
          feat: { slug: 'polearm-master' },
          skillProficiency: { skill: 'athletics' }
        }
      }
    };
    const d = derive(char, makeLookup());

    const speciesEntry = d.pendingFeatureChoices.find(
      (e) => e.kind === 'species' && e.featureSlug === 'custom-lineage'
    );
    expect(speciesEntry).toBeDefined();
    expect(speciesEntry!.unresolved).toBe(false);
    expect((speciesEntry!.picks as Record<string, unknown>).feat).toEqual({ slug: 'polearm-master' });
  });

  it('defers-loads the chosen feat so its action-modifier fires on a reach attack', () => {
    const char: CharacterDocument = {
      ...WITH_ELVEN_SCORN,
      species: {
        ...BASE_CHAR.species,
        choices: { feat: { slug: 'polearm-master' } }
      }
    };
    const d = derive(char, makeLookup());

    // Elven Scorn is a reach+melee weapon; PAM's action-modifier should apply.
    const scornAttack = d.actions.find((a) => a.sourceContent.slug === 'elven-scorn');
    expect(scornAttack).toBeDefined();
    const modIds = scornAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(modIds).toContain('polearm-master-bonus-attack');
  });

  it('synthesises the species ASI alongside the feat pick', () => {
    const char: CharacterDocument = {
      ...BASE_CHAR,
      species: {
        ...BASE_CHAR.species,
        choices: {
          asi: { ability: 'str' },
          feat: { slug: 'polearm-master' }
        }
      }
    };
    const d = derive(char, makeLookup());

    // STR base 16 + Custom Lineage ASI +2 = 18
    expect(d.stats.abilities.str.score).toBe(18);
  });
});
