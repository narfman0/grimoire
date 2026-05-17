// The user's Tortle Chronurgy Magic Wizard L5.
// Tortle lives in grimoire-packs/tortle-package; Chronurgy subclass in
// grimoire-packs/wildemount; Wizard base class in content-packs/srd-5.2.

import type { CharacterDocument } from '$lib/rules/types';

export const CHARACTER: CharacterDocument = {
  id: 'fixture-chronurgy',
  name: 'Shellmar Tideslip',
  alignment: 'NG',
  classes: [
    {
      slug: 'wizard',
      level: 5,
      subclass: 'chronurgy-magic',
      hpRolledPerLevel: [6, 4, 4, 4, 4]
    }
  ],
  species: { kind: 'species', slug: 'tortle', version: 1 },
  feats: [],
  abilityScores: {
    str: 8,
    dex: 14,
    con: 14,
    int: 15,
    wis: 12,
    cha: 10
  },
  proficienciesChosen: {
    skills: ['arcana', 'investigation']
  },
  inventory: [
    {
      contentKind: 'item',
      contentSlug: 'quarterstaff',
      version: 1,
      equipped: true,
      attuned: false
    }
  ],
  spells: {
    known: [
      { kind: 'spell', slug: 'fire-bolt' },
      { kind: 'spell', slug: 'mage-hand' },
      { kind: 'spell', slug: 'mage-armor' },
      { kind: 'spell', slug: 'magic-missile' },
      { kind: 'spell', slug: 'shield' },
      { kind: 'spell', slug: 'fireball' },
      { kind: 'spell', slug: 'counterspell' }
    ],
    prepared: ['fire-bolt', 'mage-hand', 'mage-armor', 'magic-missile', 'shield', 'fireball', 'counterspell']
  },
  currentHp: 32,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: [],
  modifierToggles: {}
};
