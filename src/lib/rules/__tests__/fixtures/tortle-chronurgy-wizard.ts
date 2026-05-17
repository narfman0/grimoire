// Tortle (Tortle Package, non-SRD) Chronurgy Magic (Wildemount, non-SRD)
// Wizard L5. Exercises: Tortle natural-armor AC override (17, no Dex),
// Temporal Awareness initiative bonus, Chronal Shift trigger (reaction on
// roll), Wizard spellcasting (DC, attack, slots).

import type { CharacterDocument, ContentLookup, ContentRow } from '../../types';

export const INLINE_CONTENT: Record<string, ContentRow> = {
  'species/tortle': {
    kind: 'species',
    slug: 'tortle',
    version: 1,
    source: 'tortle-package',
    name: 'Tortle (legacy)',
    data: {
      size: 'medium',
      speed: { walk: 30, swim: 30 },
      languages: ['common', 'aquan'],
      modifiers: [
        { kind: 'stat-modifier', target: 'ability.str', mode: 'ADD', value: 2 },
        { kind: 'stat-modifier', target: 'ability.wis', mode: 'ADD', value: 1 },
        { kind: 'stat-modifier', target: 'ac.formula', mode: 'OVERRIDE', value: { base: 17 } },
        { kind: 'stat-modifier', target: 'proficiency.skill.survival', mode: 'OVERRIDE', value: true }
      ],
      features: ['hold-breath-tortle', 'shell-defense']
    }
  },
  'feature/hold-breath-tortle': {
    kind: 'feature',
    slug: 'hold-breath-tortle',
    version: 1,
    source: 'tortle-package',
    name: 'Hold Breath',
    data: {
      ownerKind: 'species',
      ownerSlug: 'tortle',
      modifiers: [
        { kind: 'stat-modifier', target: 'flag.hold-breath-1hr', mode: 'OVERRIDE', value: true }
      ]
    }
  },
  'feature/shell-defense': {
    kind: 'feature',
    slug: 'shell-defense',
    version: 1,
    source: 'tortle-package',
    name: 'Shell Defense',
    data: {
      ownerKind: 'species',
      ownerSlug: 'tortle',
      activities: [
        {
          id: 'shell-defense-activate',
          type: 'utility',
          name: 'Shell Defense',
          cost: 'action'
        }
      ]
    }
  },
  'subclass/chronurgy-magic': {
    kind: 'subclass',
    slug: 'chronurgy-magic',
    version: 1,
    source: 'wildemount',
    name: 'Chronurgy Magic',
    data: {
      parentClass: 'wizard',
      features: ['chronal-shift', 'temporal-awareness']
    }
  },
  'feature/chronal-shift': {
    kind: 'feature',
    slug: 'chronal-shift',
    version: 1,
    source: 'wildemount',
    name: 'Chronal Shift',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'chronurgy-magic',
      minLevel: 2,
      triggers: [
        {
          kind: 'trigger',
          id: 'chronal-shift',
          name: 'Chronal Shift',
          on: ['attack.declare', 'save.declare', 'check.declare'],
          scope: { predicates: [{ 'distance.from-self.ft': { lte: 30 } }] },
          grants: { type: 'force-reroll' },
          limit: { per: 'long-rest', uses: 2 }
        }
      ]
    }
  },
  'feature/temporal-awareness': {
    kind: 'feature',
    slug: 'temporal-awareness',
    version: 1,
    source: 'wildemount',
    name: 'Temporal Awareness',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'chronurgy-magic',
      minLevel: 2,
      modifiers: [
        { kind: 'stat-modifier', target: 'initiative', mode: 'ADD', value: 'intMod' }
      ]
    }
  }
};

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

export function makeLookup(srd: Map<string, ContentRow>): ContentLookup {
  return (ref) => {
    const key = `${ref.kind}/${ref.slug}`;
    return INLINE_CONTENT[key] ?? srd.get(key);
  };
}
