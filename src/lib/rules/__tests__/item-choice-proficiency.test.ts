// Parametric proficiency on an ITEM (living gloves) + forced check
// failure (crown of the forest).
//
// `resolveChoicePicks` had no `item` branch, so item choice slots were
// engine-read only for `spell` / `baseWeapon`; a pick recorded on the
// inventory slot synthesized nothing. It now drives the same six
// proficiency-pick specs feature rows use, gated on attunement.
//
// `skill.autoFail.<slug>` / `check.autoFail.<ability>` express "this
// check fails automatically" — a distinct outcome from disadvantage.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-rogue',
  version: 1,
  source: 'test',
  name: 'Test Rogue',
  data: { hitDie: 8, primaryAbility: 'dex', saves: ['dex', 'int'] }
};

const SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

const GLOVES: ContentRow = {
  kind: 'item',
  slug: 'living-gloves',
  version: 1,
  source: 'test',
  name: 'Living Gloves',
  data: {
    category: 'wondrous',
    requiresAttunement: true,
    choices: {
      skillProficiency: { allowedSkills: ['acrobatics', 'sleight-of-hand'] },
      expertise: { allowedSkills: 'proficient' },
      toolProficiency: { allowedTools: ['thieves-tools'] }
    }
  }
};

const CROWN: ContentRow = {
  kind: 'item',
  slug: 'crown-of-the-forest',
  version: 1,
  source: 'test',
  name: 'Crown of the Forest',
  data: {
    category: 'wondrous',
    modifiers: [
      { kind: 'stat-modifier', target: 'skill.autoFail.investigation', value: true },
      { kind: 'stat-modifier', target: 'check.autoFail.int', value: true }
    ]
  }
};

function makeLookup(): ContentLookup {
  const rows = [CLASS, SPECIES, GLOVES, CROWN];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function character(
  inventory: CharacterDocument['inventory'],
  overrides: Partial<CharacterDocument> = {}
): CharacterDocument {
  return {
    id: 'item-choice-test',
    name: 'Gloved',
    classes: [{ slug: 'test-rogue', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory,
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

function glovesSlot(attuned: boolean, choices?: Record<string, unknown>) {
  return [
    {
      contentKind: 'item',
      contentSlug: 'living-gloves',
      version: 1,
      equipped: true,
      attuned,
      ...(choices ? { choices } : {})
    }
  ];
}

describe('item choice slots — proficiency picks', () => {
  const PICKS = {
    skillProficiency: { skill: 'sleight-of-hand' },
    expertise: { skill: 'sleight-of-hand' },
    toolProficiency: { tool: 'thieves-tools' }
  };

  it('synthesizes proficiency + expertise + tool from the inventory slot', () => {
    const d = derive(character(glovesSlot(true, PICKS)), makeLookup());
    expect(d.stats.skills['sleight-of-hand'].proficient).toBe(true);
    expect(d.stats.skills['sleight-of-hand'].expertise).toBe(true);
    expect(d.stats.tools).toContain('thieves-tools');
    // dex +3, PB 3, expertise doubles → 3 + 3 + 3 = 9
    expect(d.stats.skills['sleight-of-hand'].bonus).toBe(9);
  });

  it('synthesizes nothing while the attunement item is unattuned', () => {
    const d = derive(character(glovesSlot(false, PICKS)), makeLookup());
    expect(d.stats.skills['sleight-of-hand'].proficient).toBe(false);
    expect(d.stats.tools).not.toContain('thieves-tools');
    // The pick surface still exists so it can be recorded before attuning.
    expect(d.pendingItemChoices.map((c) => c.choice).sort()).toEqual([
      'expertise',
      'skillProficiency',
      'toolProficiency'
    ]);
  });

  it('honors the declaration allow-list', () => {
    const d = derive(
      character(glovesSlot(true, { skillProficiency: { skill: 'arcana' } })),
      makeLookup()
    );
    expect(d.stats.skills.arcana.proficient).toBe(false);
  });

  it('keeps picks per inventory slot (two copies, different skills)', () => {
    const d = derive(
      character([
        ...glovesSlot(true, { skillProficiency: { skill: 'sleight-of-hand' } }),
        {
          contentKind: 'item',
          contentSlug: 'living-gloves',
          version: 1,
          equipped: true,
          attuned: true,
          choices: { skillProficiency: { skill: 'acrobatics' } }
        }
      ]),
      makeLookup()
    );
    expect(d.stats.skills['sleight-of-hand'].proficient).toBe(true);
    expect(d.stats.skills.acrobatics.proficient).toBe(true);
  });

  it('leaves the pre-existing spell / baseWeapon slot semantics alone', () => {
    // A scalar-string pick in the `spell` slot must not be mistaken for a
    // proficiency-pick payload.
    const scroll: ContentRow = {
      kind: 'item',
      slug: 'test-scroll',
      version: 1,
      source: 'test',
      name: 'Scroll',
      data: { category: 'scroll', choices: { spell: { maxLevel: 3 } } }
    };
    const lookup: ContentLookup = (ref) =>
      ref.slug === 'test-scroll' ? scroll : makeLookup()(ref);
    const d = derive(
      character([
        {
          contentKind: 'item',
          contentSlug: 'test-scroll',
          version: 1,
          equipped: true,
          attuned: false,
          choices: { spell: 'fireball' }
        }
      ]),
      lookup
    );
    expect(d.validations.some((v) => v.code.startsWith('unknown-'))).toBe(false);
    expect(d.pendingItemChoices[0].picked).toBe('fireball');
  });
});

describe('forced check failure', () => {
  const crownSlot = [
    { contentKind: 'item', contentSlug: 'crown-of-the-forest', version: 1, equipped: true, attuned: false }
  ];

  it('marks the skill cell and the raw-ability record', () => {
    const d = derive(character(crownSlot), makeLookup());
    expect(d.stats.skills.investigation.autoFail).toBe(true);
    expect(d.stats.abilityCheckAutoFail).toEqual({ int: true });
    // check.autoFail.<ab> folds into every skill of that ability.
    expect(d.stats.skills.arcana.autoFail).toBe(true);
    // …and nothing else.
    expect(d.stats.skills.perception.autoFail).toBeUndefined();
  });

  it('is absent by default and distinct from disadvantage', () => {
    const d = derive(character([]), makeLookup());
    expect(d.stats.skills.investigation.autoFail).toBeUndefined();
    expect(d.stats.skills.investigation.disadvantage).toBe(false);
    expect(d.stats.abilityCheckAutoFail).toEqual({});
  });
});
