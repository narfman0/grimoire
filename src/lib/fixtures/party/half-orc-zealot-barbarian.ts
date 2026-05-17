// The user's Half-Orc Path of the Zealot Barbarian L3.
// Half-Orc lives in grimoire-packs/phb-2014; Zealot subclass in
// grimoire-packs/phb-2024; Barbarian base class in content-packs/srd-5.2.

import type { CharacterDocument } from '$lib/rules/types';

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
  conditions: ['rage'], // demonstrates condition-gated modifiers (rage damage + divine fury)
  modifierToggles: {
    'savage-attacks-extra-die': true,
    'divine-fury-bonus': true,
    'reckless-attack-toggle': false
  }
};
