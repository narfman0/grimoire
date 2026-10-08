// Weapon Mastery as a real choice slot. Before, the class feature declared
// a `choice` nothing read and set a bare `trait.weapon-mastery-chosen`
// flag, so the sheet showed a "Weapon Mastery Chosen" chip with no way to
// choose anything.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});
const lookup = (ref: { kind: string; slug: string }) => PACKS.get(`${ref.kind}/${ref.slug}`);

function barbarian(level: number, patch: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'wm',
    name: 'Ogila',
    classes: [{ slug: 'barbarian', level, hpRolledPerLevel: Array.from({ length: level }, () => 7) }],
    species: { kind: 'species', slug: 'orc', version: 1 },
    feats: [],
    abilityScores: { str: 17, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    proficienciesChosen: {},
    inventory: [
      { contentKind: 'item', contentSlug: 'greataxe', version: 1, equipped: true, attuned: false },
      { contentKind: 'item', contentSlug: 'javelin', version: 1, equipped: true, attuned: false }
    ],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...patch
  };
}

const entry = (doc: CharacterDocument) =>
  derive(doc, lookup).pendingFeatureChoices.find((p) => p.featureSlug === 'weapon-mastery')!;

describe('Weapon Mastery choice slot', () => {
  it('surfaces an unresolved pick with the level-scaled count', () => {
    expect(entry(barbarian(1)).declarations.weaponMasteries.picks).toBe(2);
    expect(entry(barbarian(4)).declarations.weaponMasteries.picks).toBe(3);
    expect(entry(barbarian(10)).declarations.weaponMasteries.picks).toBe(4);
    expect(entry(barbarian(1)).unresolved).toBe(true);
  });

  it('stays unresolved until every pick is made', () => {
    const partial = barbarian(1, {
      featureChoices: { 'weapon-mastery': { weaponMasteries: [{ weapon: 'greataxe' }] } }
    });
    expect(entry(partial).unresolved).toBe(true);
    const full = barbarian(1, {
      featureChoices: {
        'weapon-mastery': { weaponMasteries: [{ weapon: 'greataxe' }, { weapon: 'longbow' }] }
      }
    });
    expect(entry(full).unresolved).toBe(false);
  });

  it("tags attacks with a chosen weapon's mastery, and only those", () => {
    const d = derive(
      barbarian(1, {
        featureChoices: {
          'weapon-mastery': { weaponMasteries: [{ weapon: 'greataxe' }, { weapon: 'longbow' }] }
        }
      }),
      lookup
    );
    const axe = d.actions.find((a) => a.sourceContent.slug === 'greataxe')!;
    const javelin = d.actions.find((a) => a.sourceContent.slug === 'javelin')!;
    expect(axe.weaponMastery).toBe('cleave');
    expect(javelin.weaponMastery).toBeUndefined();
  });

  it('no longer emits the placeholder weapon-mastery-chosen trait', () => {
    const d = derive(barbarian(1), lookup);
    expect(JSON.stringify(d.stats)).not.toContain('weapon-mastery-chosen');
  });
});
