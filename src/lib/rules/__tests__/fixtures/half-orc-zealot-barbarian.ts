// Half-Orc (2014 PHB legacy, lives in grimoire-packs/phb-2014) Path of the
// Zealot (2024 PHB non-SRD, lives in grimoire-packs/phb-2024) Barbarian L3.
// All referenced content is loaded by the test helper from disk — no
// inline content needed here anymore.

import type { CharacterDocument, ContentLookup, ContentRow } from '../../types';

export const CHARACTER: CharacterDocument = {
  id: 'fixture-zealot',
  name: 'Vorm Skullsplitter',
  alignment: 'CN',
  classes: [
    {
      slug: 'barbarian',
      level: 3,
      subclass: 'path-of-the-zealot',
      hpRolledPerLevel: [12, 7, 7]
    }
  ],
  species: { kind: 'species', slug: 'half-orc', version: 1 },
  feats: [],
  abilityScores: {
    str: 15,
    dex: 13,
    con: 13,
    int: 8,
    wis: 12,
    cha: 10
  },
  proficienciesChosen: {
    skills: ['athletics', 'perception']
  },
  inventory: [
    {
      contentKind: 'item',
      contentSlug: 'greatsword',
      version: 1,
      equipped: true,
      attuned: false
    }
  ],
  spells: { known: [], prepared: [] },
  currentHp: 32,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: ['rage'], // rage active for the fixture; exercises condition-gated modifiers
  modifierToggles: {
    'savage-attacks-extra-die': true,
    'divine-fury-bonus': true,
    'reckless-attack-toggle': false
  }
};

export function makeLookup(packs: Map<string, ContentRow>): ContentLookup {
  return (ref) => packs.get(`${ref.kind}/${ref.slug}`);
}
