// Conditional-on-existing-proficiency choice routing.
//
// Contract: a feature / subclass / feat row's `data.choices` entry for
// skillProficiency or savingThrow (or language / toolProficiency) can
// ship an `elseAlready` override:
//
//   data.choices.skillProficiency = {
//     allowedSkills: ['insight', 'perception', 'persuasion'],
//     elseAlready: {
//       targetPrefix: 'expertise.skill',
//       mode: 'OVERRIDE',
//       value: true
//     }
//   }
//
// When the player's recorded pick is already in the character's
// baseline proficiency set (non-choice sources: proficienciesChosen,
// class.saves arrays, and `proficiency.<kind>.<slug>` modifiers on
// active rows), derive() emits the `elseAlready` modifier instead of
// the default `proficiency.<kind>.<pick>` grant.
//
// This unblocks Iron Mind / Elegant Courtier–style features that read
// "gain proficiency in X; if you already have proficiency, gain Y
// instead" (Y = Expertise for skills; Y = save-expertise for saves).

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const CLASS_ROW: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: {
    hitDie: 10,
    primaryAbility: 'wis',
    // Class grants wis save baseline. Anything not in this list is not
    // baseline-proficient.
    saves: ['wis']
  }
};

const SUBCLASS_ROW: ContentRow = {
  kind: 'subclass',
  slug: 'test-subclass',
  version: 1,
  source: 'test',
  name: 'Test Subclass',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [
      { level: 1, name: 'Iron Mind' },
      { level: 1, name: 'Elegant Courtier' }
    ]
  }
};

const SPECIES_ROW: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {
    // Species grants perception proficiency as a baseline (matches
    // patterns like Half-Elf / Variant Human Skill Versatility-style
    // fixed grants on the row's modifiers list).
    modifiers: [
      { kind: 'stat-modifier', target: 'proficiency.skill.perception', mode: 'OVERRIDE', value: true }
    ]
  }
};

// Elegant Courtier-shape feature — pick a skill from {insight, perception,
// persuasion}; if already proficient, gain Expertise instead.
const ELEGANT_COURTIER: ContentRow = {
  kind: 'feature',
  slug: 'elegant-courtier',
  version: 1,
  source: 'test',
  name: 'Elegant Courtier',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      skillProficiency: {
        allowedSkills: ['insight', 'perception', 'persuasion'],
        elseAlready: {
          targetPrefix: 'expertise.skill',
          mode: 'OVERRIDE',
          value: true
        }
      }
    }
  }
};

// Iron Mind-shape feature — pick a save from {wis, int, cha}; if already
// proficient, route to save expertise (doubles PB on that save).
const IRON_MIND: ContentRow = {
  kind: 'feature',
  slug: 'iron-mind',
  version: 1,
  source: 'test',
  name: 'Iron Mind',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      savingThrow: {
        allowedAbilities: ['wis', 'int', 'cha'],
        elseAlready: {
          targetPrefix: 'expertise.save',
          mode: 'OVERRIDE',
          value: true
        }
      }
    }
  }
};

function makeLookup(): ContentLookup {
  const rows: ContentRow[] = [
    CLASS_ROW,
    SUBCLASS_ROW,
    SPECIES_ROW,
    ELEGANT_COURTIER,
    IRON_MIND
  ];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(opts: {
  featureChoices?: Record<string, Record<string, unknown>>;
  chosenSkills?: string[];
}): CharacterDocument {
  return {
    id: 'test-cond-prof',
    name: 'Test',
    classes: [{ slug: 'test-class', level: 5, subclass: 'test-subclass', hpRolledPerLevel: [10, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 14, int: 12, wis: 16, cha: 10 },
    proficienciesChosen: { skills: opts.chosenSkills ?? [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices: opts.featureChoices
  };
}

describe('conditional-on-existing-proficiency — skillProficiency.elseAlready', () => {
  it('emits the default modifier (proficiency) when pick is NOT already proficient', () => {
    // perception is baseline-proficient (species grant); persuasion is not.
    const d = derive(
      baseCharacter({
        featureChoices: { 'elegant-courtier': { skillProficiency: { skill: 'persuasion' } } }
      }),
      makeLookup()
    );
    expect(d.stats.skills.persuasion?.proficient).toBe(true);
    expect(d.stats.skills.persuasion?.expertise).toBe(false);
  });

  it('emits the alternate modifier (expertise) when pick IS already proficient via species', () => {
    // perception is granted by species → already-proficient → expertise routing.
    const d = derive(
      baseCharacter({
        featureChoices: { 'elegant-courtier': { skillProficiency: { skill: 'perception' } } }
      }),
      makeLookup()
    );
    expect(d.stats.skills.perception?.proficient).toBe(true);
    expect(d.stats.skills.perception?.expertise).toBe(true);
  });

  it('emits the alternate modifier when pick is already proficient via proficienciesChosen', () => {
    // insight is added through character.proficienciesChosen.skills.
    const d = derive(
      baseCharacter({
        chosenSkills: ['insight'],
        featureChoices: { 'elegant-courtier': { skillProficiency: { skill: 'insight' } } }
      }),
      makeLookup()
    );
    expect(d.stats.skills.insight?.proficient).toBe(true);
    expect(d.stats.skills.insight?.expertise).toBe(true);
  });

  it('emits nothing when no pick is recorded', () => {
    const d = derive(baseCharacter({}), makeLookup());
    // None of the three allowed skills should be proficient or expertise.
    expect(d.stats.skills.insight?.proficient).toBe(false);
    expect(d.stats.skills.persuasion?.proficient).toBe(false);
    // perception stays proficient (from species), but expertise must not have
    // been spuriously granted.
    expect(d.stats.skills.perception?.proficient).toBe(true);
    expect(d.stats.skills.perception?.expertise).toBe(false);
  });

  it('falls back to default routing when pick is outside the allow-list', () => {
    // 'arcana' is not in allowedSkills — pick should silently drop.
    const d = derive(
      baseCharacter({
        featureChoices: { 'elegant-courtier': { skillProficiency: { skill: 'arcana' } } }
      }),
      makeLookup()
    );
    expect(d.stats.skills.arcana?.proficient).toBe(false);
    expect(d.stats.skills.arcana?.expertise).toBe(false);
  });
});

describe('conditional-on-existing-proficiency — savingThrow.elseAlready', () => {
  it('emits the default save proficiency when pick is NOT already proficient', () => {
    // int is not class-baseline → default proficiency.save target.
    const d = derive(
      baseCharacter({
        featureChoices: { 'iron-mind': { savingThrow: { ability: 'int' } } }
      }),
      makeLookup()
    );
    expect(d.stats.saves.int.proficient).toBe(true);
    expect(d.stats.saves.int.expertise).toBe(false);
  });

  it('emits the alternate (save expertise) when pick IS already proficient via class.saves', () => {
    // wis is in class saves → baseline-proficient → expertise route.
    const d = derive(
      baseCharacter({
        featureChoices: { 'iron-mind': { savingThrow: { ability: 'wis' } } }
      }),
      makeLookup()
    );
    expect(d.stats.saves.wis.proficient).toBe(true);
    expect(d.stats.saves.wis.expertise).toBe(true);
    // PB for level 5 is +3; WIS mod is +3; expertise doubles PB to +6 → bonus 9.
    expect(d.stats.saves.wis.bonus).toBe(3 /* wisMod */ + 3 /* pb */ + 3 /* expertise PB */);
  });

  it('emits nothing when no pick recorded for the save slot', () => {
    const d = derive(baseCharacter({}), makeLookup());
    // wis is already proficient from class; iron mind without a pick must
    // not have flipped expertise on.
    expect(d.stats.saves.wis.proficient).toBe(true);
    expect(d.stats.saves.wis.expertise).toBe(false);
    // int / cha must remain non-proficient.
    expect(d.stats.saves.int.proficient).toBe(false);
    expect(d.stats.saves.cha.proficient).toBe(false);
  });

  it('handles both features at once — skill expertise + save expertise', () => {
    const d = derive(
      baseCharacter({
        featureChoices: {
          'elegant-courtier': { skillProficiency: { skill: 'perception' } },
          'iron-mind': { savingThrow: { ability: 'wis' } }
        }
      }),
      makeLookup()
    );
    expect(d.stats.skills.perception?.expertise).toBe(true);
    expect(d.stats.saves.wis.expertise).toBe(true);
  });
});

describe('conditional-on-existing-proficiency — ordering / baseline scope', () => {
  it('does not consider another choice-driven skill prof grant as "already proficient"', () => {
    // Two active features: feature A picks `persuasion` via a plain
    // skillProficiency choice (no elseAlready); feature B uses elseAlready
    // and also picks `persuasion`. The "already proficient" check must
    // NOT see feature A's pick — it only looks at non-choice baseline
    // sources — so feature B should emit the default proficiency, not
    // expertise. This keeps ordering deterministic regardless of which
    // feature derive() processes first.
    const FEATURE_A: ContentRow = {
      kind: 'feature',
      slug: 'plain-pick',
      version: 1,
      source: 'test',
      name: 'Plain Pick',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'ordering-subclass',
        minLevel: 1,
        choices: { skillProficiency: { allowedSkills: ['persuasion'] } }
      }
    };
    const FEATURE_B: ContentRow = {
      kind: 'feature',
      slug: 'else-pick',
      version: 1,
      source: 'test',
      name: 'Else Pick',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'ordering-subclass',
        minLevel: 1,
        choices: {
          skillProficiency: {
            allowedSkills: ['persuasion'],
            elseAlready: { targetPrefix: 'expertise.skill', mode: 'OVERRIDE', value: true }
          }
        }
      }
    };
    const ORDERING_SUBCLASS: ContentRow = {
      kind: 'subclass',
      slug: 'ordering-subclass',
      version: 1,
      source: 'test',
      name: 'Ordering Subclass',
      data: {
        parentClass: 'test-class',
        subclassFeatures: [
          { level: 1, name: 'Plain Pick' },
          { level: 1, name: 'Else Pick' }
        ]
      }
    };
    const rows: ContentRow[] = [CLASS_ROW, ORDERING_SUBCLASS, SPECIES_ROW, FEATURE_A, FEATURE_B];
    const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
    const lookup: ContentLookup = (ref) => map.get(`${ref.kind}/${ref.slug}`);

    const character: CharacterDocument = {
      ...baseCharacter({
        featureChoices: {
          'plain-pick': { skillProficiency: { skill: 'persuasion' } },
          'else-pick': { skillProficiency: { skill: 'persuasion' } }
        }
      }),
      classes: [{ slug: 'test-class', level: 5, subclass: 'ordering-subclass', hpRolledPerLevel: [10, 6, 6, 6, 6] }]
    };
    const d = derive(character, lookup);
    // Both rows emit at proficiency.skill.persuasion — proficient = true.
    expect(d.stats.skills.persuasion?.proficient).toBe(true);
    // Critically: expertise is NOT granted, because the elseAlready
    // baseline check ignores choice-driven grants from other features.
    expect(d.stats.skills.persuasion?.expertise).toBe(false);
  });

  it('emits default modifier when decl omits elseAlready (back-compat)', () => {
    // Lookup with a feature that has no elseAlready — even if the pick is
    // already proficient, only the default proficiency modifier should be
    // emitted (no spurious expertise).
    const NO_ELSE_ROW: ContentRow = {
      kind: 'feature',
      slug: 'no-else-feature',
      version: 1,
      source: 'test',
      name: 'No Else',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'test-subclass',
        minLevel: 1,
        choices: {
          skillProficiency: { allowedSkills: ['perception'] }
        }
      }
    };
    const PATCHED_SUBCLASS: ContentRow = {
      ...SUBCLASS_ROW,
      data: { ...SUBCLASS_ROW.data, subclassFeatures: [{ level: 1, name: 'No Else' }] }
    };
    const rows: ContentRow[] = [CLASS_ROW, PATCHED_SUBCLASS, SPECIES_ROW, NO_ELSE_ROW];
    const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
    const lookup: ContentLookup = (ref) => map.get(`${ref.kind}/${ref.slug}`);
    const character = baseCharacter({
      featureChoices: { 'no-else-feature': { skillProficiency: { skill: 'perception' } } }
    });
    const d = derive(character, lookup);
    expect(d.stats.skills.perception?.proficient).toBe(true);
    expect(d.stats.skills.perception?.expertise).toBe(false);
  });
});
