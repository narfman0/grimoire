// Half-Orc (2014 legacy, would live in grimoire-packs) Path of the Zealot
// (Xanathar's, also non-SRD) Barbarian L3. Used to exercise: ASI stacking
// from a legacy species, unarmored defense AC formula, Reckless Attack
// toggle, Rage condition + Rage damage action-modifier, Relentless
// Endurance trigger, Divine Fury action-modifier (first hit while raging).

import type { CharacterDocument, ContentLookup, ContentRow } from '../../types';

export const INLINE_CONTENT: Record<string, ContentRow> = {
  'species/half-orc': {
    kind: 'species',
    slug: 'half-orc',
    version: 1,
    source: 'phb-2014',
    name: 'Half-Orc (legacy)',
    data: {
      size: 'medium',
      speed: { walk: 30 },
      languages: ['common', 'orc'],
      modifiers: [
        { kind: 'stat-modifier', target: 'ability.str', mode: 'ADD', value: 2 },
        { kind: 'stat-modifier', target: 'ability.con', mode: 'ADD', value: 1 },
        { kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 },
        { kind: 'stat-modifier', target: 'proficiency.skill.intimidation', mode: 'OVERRIDE', value: true }
      ],
      features: ['relentless-endurance-legacy', 'savage-attacks-legacy']
    }
  },
  'feature/relentless-endurance-legacy': {
    kind: 'feature',
    slug: 'relentless-endurance-legacy',
    version: 1,
    source: 'phb-2014',
    name: 'Relentless Endurance',
    data: {
      ownerKind: 'species',
      ownerSlug: 'half-orc',
      triggers: [
        {
          kind: 'trigger',
          id: 'relentless-endurance',
          name: 'Relentless Endurance',
          on: ['damage.reduce-to-zero'],
          scope: { predicates: [{ self: true }] },
          grants: { type: 'set-hp', value: 1 },
          limit: { per: 'long-rest', uses: 1 }
        }
      ]
    }
  },
  'feature/savage-attacks-legacy': {
    kind: 'feature',
    slug: 'savage-attacks-legacy',
    version: 1,
    source: 'phb-2014',
    name: 'Savage Attacks',
    data: {
      ownerKind: 'species',
      ownerSlug: 'half-orc',
      modifiers: [
        {
          kind: 'action-modifier',
          id: 'savage-attacks-extra-die',
          name: 'Savage Attacks (crit extra die)',
          appliesTo: {
            activityType: 'attack',
            predicates: [
              { 'attack.range': 'melee' }
            ]
          },
          effects: [
            { target: 'crit.extra-weapon-die', mode: 'ADD', value: 1 }
          ]
        }
      ]
    }
  },
  'subclass/path-of-the-zealot': {
    kind: 'subclass',
    slug: 'path-of-the-zealot',
    version: 1,
    source: 'xanathars',
    name: 'Path of the Zealot',
    data: {
      parentClass: 'barbarian',
      features: ['divine-fury', 'warrior-of-the-gods']
    }
  },
  'feature/divine-fury': {
    kind: 'feature',
    slug: 'divine-fury',
    version: 1,
    source: 'xanathars',
    name: 'Divine Fury',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'path-of-the-zealot',
      minLevel: 3,
      modifiers: [
        {
          kind: 'action-modifier',
          id: 'divine-fury-bonus',
          name: 'Divine Fury (first hit/turn while raging)',
          appliesWhen: { condition: 'rage' },
          appliesTo: {
            activityType: 'attack',
            predicates: [{ 'attack.range': 'melee' }]
          },
          effects: [{ target: 'damage.bonus', mode: 'ADD', value: 1 }]
        }
      ]
    }
  },
  'feature/warrior-of-the-gods': {
    kind: 'feature',
    slug: 'warrior-of-the-gods',
    version: 1,
    source: 'xanathars',
    name: 'Warrior of the Gods',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'path-of-the-zealot',
      minLevel: 3,
      modifiers: [
        { kind: 'stat-modifier', target: 'flag.no-material-component-on-revive', mode: 'OVERRIDE', value: true }
      ]
    }
  }
};

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
  conditions: ['rage'], // rage active for the fixture; verifies condition-gated modifiers
  modifierToggles: {
    'savage-attacks-extra-die': true,
    'divine-fury-bonus': true,
    'reckless-attack-toggle': false
  }
};

export function makeLookup(srd: Map<string, ContentRow>): ContentLookup {
  return (ref) => {
    const key = `${ref.kind}/${ref.slug}`;
    return INLINE_CONTENT[key] ?? srd.get(key);
  };
}
