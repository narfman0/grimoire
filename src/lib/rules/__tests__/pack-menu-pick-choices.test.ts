// C.5 follow-up: verify that the choice-synthesis pass (commit 67948cc)
// composes per-feature `data.choices.skillProficiency` picks correctly
// for the canonical 1-of-N subclass-feature shape now landing in
// grimoire-packs (acolyte-of-nature, otherworldly-glamour, ...).
//
// Built against synthetic content rows (no SRD loader, no pack walk) so
// the test is hermetic and CI-portable. The synthetic shape mirrors the
// real pack rows authored alongside this test:
//   /home/narfman0/workspace/grimoire-packs/phb-2014/features/nature-domain.json
//   /home/narfman0/workspace/grimoire-packs/phb-2024/features/fey-wanderer.json
//
// What we assert:
//   1. A valid pick inside the allow-list synthesizes the right
//      `proficiency.skill.<slug> OVERRIDE true` modifier (-> skill.proficient).
//   2. Non-picked allow-list options stay non-proficient (no over-grant).
//   3. A pick outside the allow-list is silently dropped (graceful denial).
//   4. featureChoices absent / undefined → no synthesis, no crash.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// --- synthetic content -------------------------------------------------------

const SYNTH_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: {
    hitDie: 8,
    primaryAbility: 'wis',
    savingThrows: ['wis', 'cha']
  }
};

// One subclass with two features attached: an acolyte-of-nature analogue
// (1-of-3 nature skills) and an otherworldly-glamour analogue (1-of-3
// social skills). Both use the canonical pack shape.
const SYNTH_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'test-subclass',
  version: 1,
  source: 'test',
  name: 'Test Subclass',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [
      { level: 1, name: 'Nature Pick' },
      { level: 1, name: 'Social Pick' }
    ]
  }
};

const FEATURE_NATURE_PICK: ContentRow = {
  kind: 'feature',
  slug: 'nature-pick',
  version: 1,
  source: 'test',
  name: 'Nature Pick',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      skillProficiency: {
        allowedSkills: ['animal-handling', 'nature', 'survival']
      }
    }
  }
};

const FEATURE_SOCIAL_PICK: ContentRow = {
  kind: 'feature',
  slug: 'social-pick',
  version: 1,
  source: 'test',
  name: 'Social Pick',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      skillProficiency: {
        allowedSkills: ['deception', 'performance', 'persuasion']
      }
    }
  }
};

const SYNTH_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

function makeLookup(): ContentLookup {
  const rows: ContentRow[] = [
    SYNTH_CLASS,
    SYNTH_SUBCLASS,
    FEATURE_NATURE_PICK,
    FEATURE_SOCIAL_PICK,
    SYNTH_SPECIES
  ];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(featureChoices?: Record<string, Record<string, unknown>>): CharacterDocument {
  return {
    id: 'test-pack-menu-pick',
    name: 'Test Character',
    classes: [{ slug: 'test-class', level: 1, subclass: 'test-subclass', hpRolledPerLevel: [8] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 14, cha: 12 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices
  };
}

// --- tests -------------------------------------------------------------------

describe('pack menu-pick choices — acolyte-of-nature shape (1-of-3 nature skills)', () => {
  it('synthesizes proficiency for the picked skill only (no over-grant)', () => {
    const char = baseCharacter({
      'nature-pick': { skillProficiency: { skill: 'nature' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.skills.nature?.proficient).toBe(true);
    // The other two allow-list options must NOT become proficient — that
    // would be the over-grant antipattern the audit explicitly removed.
    expect(d.stats.skills['animal-handling']?.proficient).toBe(false);
    expect(d.stats.skills.survival?.proficient).toBe(false);
  });
});

describe('pack menu-pick choices — otherworldly-glamour shape (1-of-3 social skills)', () => {
  it('synthesizes proficiency for the picked social skill only', () => {
    const char = baseCharacter({
      'social-pick': { skillProficiency: { skill: 'persuasion' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.skills.persuasion?.proficient).toBe(true);
    expect(d.stats.skills.deception?.proficient).toBe(false);
    expect(d.stats.skills.performance?.proficient).toBe(false);
  });

  it('accepts a different valid pick from the same allow-list', () => {
    const char = baseCharacter({
      'social-pick': { skillProficiency: { skill: 'deception' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.skills.deception?.proficient).toBe(true);
    expect(d.stats.skills.persuasion?.proficient).toBe(false);
  });
});

describe('pack menu-pick choices — allow-list enforcement', () => {
  it('drops a pick that is not in allowedSkills (graceful denial)', () => {
    // Player tries to pick 'acrobatics' on the nature-pick feature whose
    // allow-list is [animal-handling, nature, survival]. The synth pass
    // should refuse to emit a modifier, so acrobatics stays non-proficient.
    const char = baseCharacter({
      'nature-pick': { skillProficiency: { skill: 'acrobatics' } }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.skills.acrobatics?.proficient).toBe(false);
    // And none of the allow-list options sneak through either.
    expect(d.stats.skills.nature?.proficient).toBe(false);
    expect(d.stats.skills['animal-handling']?.proficient).toBe(false);
    expect(d.stats.skills.survival?.proficient).toBe(false);
  });
});

describe('pack menu-pick choices — empty / missing picks', () => {
  it('tolerates a character with no featureChoices at all', () => {
    const char = baseCharacter(undefined);
    // Should not throw, and should not synthesize any proficiency from
    // the choice declarations.
    const d = derive(char, makeLookup());
    expect(d.stats.skills.nature?.proficient).toBe(false);
    expect(d.stats.skills.persuasion?.proficient).toBe(false);
  });

  it('tolerates featureChoices with no entry for a row that declares choices', () => {
    const char = baseCharacter({});
    const d = derive(char, makeLookup());
    expect(d.stats.skills.nature?.proficient).toBe(false);
    expect(d.stats.skills.persuasion?.proficient).toBe(false);
  });

  it('tolerates a featureChoices entry that lacks the skillProficiency key', () => {
    const char = baseCharacter({
      'nature-pick': {} // present but empty — no pick made yet
    });
    const d = derive(char, makeLookup());
    expect(d.stats.skills.nature?.proficient).toBe(false);
  });
});
