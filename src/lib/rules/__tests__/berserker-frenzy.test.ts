// SRD 5.2 Frenzy: Reckless Attack while raging adds (Rage Damage bonus)d6
// to the first Strength-based hit each turn. The pack previously modeled
// the 2014 bonus-action "Frenzied Strike" — an attack with no damage that
// showed up even when the barbarian wasn't raging.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});
const lookup = (ref: { kind: string; slug: string }) => PACKS.get(`${ref.kind}/${ref.slug}`);

function berserker(level: number, patch: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'berserker',
    name: 'Ogila',
    classes: [
      {
        slug: 'barbarian',
        level,
        subclass: 'path-of-the-berserker',
        hpRolledPerLevel: Array.from({ length: level }, (_, i) => (i === 0 ? 12 : 7))
      }
    ],
    species: { kind: 'species', slug: 'orc', version: 1 },
    feats: [],
    abilityScores: { str: 17, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    proficienciesChosen: { skills: ['athletics', 'perception'] },
    inventory: [{ contentKind: 'item', contentSlug: 'greataxe', version: 1, equipped: true, attuned: false }],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...patch
  };
}

const greataxe = (doc: CharacterDocument) =>
  derive(doc, lookup).actions.find((a) => a.sourceContent.slug === 'greataxe')!;

describe('Berserker Frenzy (SRD 5.2)', () => {
  it('no longer emits a bonus-action Frenzied Strike attack', () => {
    const d = derive(berserker(3, { conditions: ['rage'] }), lookup);
    expect(d.actions.some((a) => a.name === 'Frenzied Strike')).toBe(false);
  });

  it('adds 2d6 of the weapon type at L3 when toggled on while raging', () => {
    const axe = greataxe(berserker(3, { conditions: ['rage'], modifierToggles: { 'frenzy-extra-damage': true } }));
    expect(axe.damageRolls).toContainEqual({ formula: '2d6', type: 'slashing' });
  });

  it('scales to 3d6 with the Rage Damage bonus at L10', () => {
    const axe = greataxe(berserker(10, { conditions: ['rage'], modifierToggles: { 'frenzy-extra-damage': true } }));
    expect(axe.damageRolls).toContainEqual({ formula: '3d6', type: 'slashing' });
  });

  it('does nothing when not raging or not toggled', () => {
    const notRaging = greataxe(berserker(3, { modifierToggles: { 'frenzy-extra-damage': true } }));
    const untoggled = greataxe(berserker(3, { conditions: ['rage'] }));
    for (const axe of [notRaging, untoggled]) {
      expect(axe.damageRolls!.some((r) => /^\dd6$/.test(r.formula))).toBe(false);
    }
  });
});
