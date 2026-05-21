// Ray'Quasar — Tortle Chronurgy Magic Wizard 10.
// Tortle species lives in grimoire-packs/tortle-package (STR+2, WIS+1, Natural Armor 17, Survival).
// Chronurgy subclass in grimoire-packs/wildemount; Wizard base class in content-packs/srd-5.2.
//
// abilityScores are pre-modifier raw values. The engine applies:
//   - tortle-package: STR+2, WIS+1
//   - Skill Expert feat choice: INT+1
//   - Amulet of Health (equipped+attuned): CON OVERRIDE 19
// The MotM flexible ASI (INT+2, CON+1) and the class-level INT ASI are baked into
// int:19 and con:14 because tortle-package (not MotM) is the active species in the DB.

import type { CharacterDocument } from '$lib/rules/types';

export const CHARACTER: CharacterDocument = {
  id: 'fixture-chronurgy',
  name: "Ray'Quasar",
  alignment: 'NG',
  classes: [
    {
      slug: 'wizard',
      level: 10,
      subclass: 'chronurgy-magic',
      hpRolledPerLevel: [6, 4, 4, 4, 4, 4, 4, 4, 4, 4]
      // sum(rolls) 42 + CON mod(+4 via amulet) × 10 = 82 HP
    }
  ],
  species: { kind: 'species', slug: 'tortle', version: 1 },
  feats: [
    {
      kind: 'feat',
      slug: 'skill-expert',
      version: 1,
      choices: {
        asi: { ability: 'int' }, // ability.int ADD 1 → INT 19→20
        skillProficiency: { skill: 'stealth' }, // proficiency.skill.stealth OVERRIDE true
        expertise: { skill: 'arcana' } // expertise.skill.arcana OVERRIDE true
      }
    },
    { kind: 'feat', slug: 'metamagic-adept', version: 1 }
  ],
  abilityScores: {
    str: 4, //  → 4 + 2 (tortle) = 6 on sheet
    dex: 12,
    con: 14, // → amulet OVERRIDE 19; natural CON without amulet = 14
    int: 19, // → 19 + 1 (Skill Expert) = 20 on sheet
    wis: 9, //  → 9 + 1 (tortle) = 10 on sheet
    cha: 9
  },
  proficienciesChosen: {
    // All 7 observed proficiencies. Survival overlaps with tortle-package auto-grant (harmless).
    // Religion source TBD — verify in app and trim if already granted by content.
    skills: ['acrobatics', 'arcana', 'history', 'investigation', 'religion', 'stealth', 'survival'],
    languages: ['draconic', 'dwarvish', 'elvish'] // Common + Aquan auto-granted by tortle-package
  },
  inventory: [
    { contentKind: 'item', contentSlug: 'amulet-of-health', version: 1, equipped: true, attuned: true },
    { contentKind: 'item', contentSlug: 'quarterstaff', version: 1, equipped: true, attuned: false },
    { contentKind: 'item', contentSlug: 'dagger', version: 1, equipped: false, attuned: false },
    { contentKind: 'item', contentSlug: 'light-crossbow', version: 1, equipped: false, attuned: false },
    { contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: false, attuned: false }
  ],
  spells: {
    known: [
      // Cantrips (Wizard 10 gets 4)
      { kind: 'spell', slug: 'mind-sliver' },
      { kind: 'spell', slug: 'fire-bolt' },
      { kind: 'spell', slug: 'light' },
      { kind: 'spell', slug: 'create-bonfire' },
      // 1st — ritual; castable from spellbook without preparation
      { kind: 'spell', slug: 'tensers-floating-disk' },
      // 2nd
      { kind: 'spell', slug: 'enlarge-reduce' },
      { kind: 'spell', slug: 'hold-person' },
      { kind: 'spell', slug: 'mind-spike' },
      { kind: 'spell', slug: 'shadow-blade' },
      { kind: 'spell', slug: 'web' },
      { kind: 'spell', slug: 'mirror-image' },
      { kind: 'spell', slug: 'dragons-breath' },
      { kind: 'spell', slug: 'misty-step' },
      { kind: 'spell', slug: 'maximilians-earthen-grasp' },
      { kind: 'spell', slug: 'aganazzars-scorcher' },
      { kind: 'spell', slug: 'scorching-ray' },
      // 3rd
      { kind: 'spell', slug: 'fireball' },
      { kind: 'spell', slug: 'phantom-steed' }, // ritual
      { kind: 'spell', slug: 'slow' },
      { kind: 'spell', slug: 'spirit-shroud' },
      { kind: 'spell', slug: 'fly' },
      { kind: 'spell', slug: 'pulse-wave' },
      { kind: 'spell', slug: 'blink' },
      // 4th
      { kind: 'spell', slug: 'greater-invisibility' },
      // 5th
      { kind: 'spell', slug: 'bigbys-hand' }
    ],
    // Prepared limit: INT mod(5) + level(10) = 15 non-cantrip slots.
    // Rituals (tensers-floating-disk, phantom-steed) free to cast unprepared.
    prepared: [
      'mind-sliver',
      'fire-bolt',
      'light',
      'create-bonfire',
      'hold-person',
      'mind-spike',
      'shadow-blade',
      'web',
      'mirror-image',
      'misty-step',
      'scorching-ray',
      'aganazzars-scorcher',
      'fireball',
      'slow',
      'fly',
      'pulse-wave',
      'greater-invisibility',
      'bigbys-hand'
    ]
  },
  currentHp: 82,
  tempHp: 0,
  hitDiceSpent: {},
  conditions: [],
  modifierToggles: {}
};
