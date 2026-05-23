// Multi-pick languages + toolProficiencies — engine extensions for the
// "pick N from M" shape used by Mastermind's two-language pick, College
// of Lore's 3-skill pick (engine-shape parallel), and Kenku Recall's
// 2-skill pick. Mirrors the existing skillProficiencies + expertises
// plural shapes.
//
// Shape contract:
//   data.choices.languages = { allowedLanguages?: string[], picks?: N }
//   data.choices.toolProficiencies = { allowedTools?: string[], picks?: N }
//   character.featureChoices[slug] = {
//     languages: [{ language: 'draconic' }, { language: 'dwarvish' }],
//     toolProficiencies: [{ tool: 'smiths-tools' }]
//   }
// Each pick synthesizes a proficiency.language.X / proficiency.tool.X
// stat-modifier (mode OVERRIDE true). Picks outside the allow-list are
// silently dropped. The `picks` count is a UI hint — engine applies
// every pick in the array.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const SYNTH_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: { hitDie: 8, primaryAbility: 'int', savingThrows: ['int', 'wis'] }
};

const SYNTH_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'test-subclass',
  version: 1,
  source: 'test',
  name: 'Test Subclass',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [
      { level: 1, name: 'Language Pick' },
      { level: 1, name: 'Tool Pick' }
    ]
  }
};

const FEATURE_LANGUAGE_PICK: ContentRow = {
  kind: 'feature',
  slug: 'language-pick',
  version: 1,
  source: 'test',
  name: 'Language Pick',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      languages: {
        allowedLanguages: ['draconic', 'dwarvish', 'elvish', 'giant'],
        picks: 2
      }
    }
  }
};

const FEATURE_TOOL_PICK: ContentRow = {
  kind: 'feature',
  slug: 'tool-pick',
  version: 1,
  source: 'test',
  name: 'Tool Pick',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    choices: {
      toolProficiencies: {
        allowedTools: ['smiths-tools', 'carpenters-tools', 'masons-tools'],
        picks: 1
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
    FEATURE_LANGUAGE_PICK,
    FEATURE_TOOL_PICK,
    SYNTH_SPECIES
  ];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(featureChoices?: Record<string, Record<string, unknown>>): CharacterDocument {
  return {
    id: 'test-multi-pick',
    name: 'Test Character',
    classes: [{ slug: 'test-class', level: 1, subclass: 'test-subclass', hpRolledPerLevel: [8] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 14, int: 14, wis: 10, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 8,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices
  };
}

describe('multi-pick languages (Mastermind shape — 2 languages)', () => {
  it('synthesizes proficiency for each picked language', () => {
    const char = baseCharacter({
      'language-pick': {
        languages: [{ language: 'draconic' }, { language: 'dwarvish' }]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.languages).toContain('draconic');
    expect(d.stats.languages).toContain('dwarvish');
    // Non-picked allow-list options stay out
    expect(d.stats.languages).not.toContain('elvish');
    expect(d.stats.languages).not.toContain('giant');
  });

  it('drops picks outside the allow-list (graceful denial)', () => {
    const char = baseCharacter({
      'language-pick': {
        languages: [{ language: 'draconic' }, { language: 'celestial' }]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.languages).toContain('draconic');
    expect(d.stats.languages).not.toContain('celestial');
  });

  it('handles a single pick when the player records fewer than picks-hint', () => {
    const char = baseCharacter({
      'language-pick': {
        languages: [{ language: 'elvish' }]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.languages).toContain('elvish');
    expect(d.stats.languages).not.toContain('draconic');
  });

  it('handles more picks than the picks-hint (engine treats picks as UI hint)', () => {
    // The engine applies every pick in the array — UI is responsible for
    // capping. Verify the engine doesn't silently drop the extras.
    const char = baseCharacter({
      'language-pick': {
        languages: [
          { language: 'draconic' },
          { language: 'dwarvish' },
          { language: 'elvish' }
        ]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.languages).toContain('draconic');
    expect(d.stats.languages).toContain('dwarvish');
    expect(d.stats.languages).toContain('elvish');
  });

  it('emits no language proficiency when picks array is missing', () => {
    const char = baseCharacter({ 'language-pick': {} });
    const d = derive(char, makeLookup());
    expect(d.stats.languages).not.toContain('draconic');
    expect(d.stats.languages).not.toContain('dwarvish');
  });
});

describe('multi-pick toolProficiencies (Student of War shape — 1 artisan tool)', () => {
  it('synthesizes proficiency for each picked tool', () => {
    const char = baseCharacter({
      'tool-pick': {
        toolProficiencies: [{ tool: 'smiths-tools' }]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.tools).toContain('smiths-tools');
    expect(d.stats.tools).not.toContain('carpenters-tools');
  });

  it('drops picks outside the allow-list', () => {
    const char = baseCharacter({
      'tool-pick': {
        toolProficiencies: [{ tool: 'thieves-tools' }]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.stats.tools).not.toContain('thieves-tools');
  });

  it('emits no tool proficiency when no picks recorded', () => {
    const char = baseCharacter({ 'tool-pick': {} });
    const d = derive(char, makeLookup());
    expect(d.stats.tools).not.toContain('smiths-tools');
    expect(d.stats.tools).not.toContain('carpenters-tools');
  });
});

describe('multi-pick — empty allow-list means anything goes', () => {
  // A row that omits allowedLanguages should accept any pick — useful for
  // 2024 backgrounds' "language of your choice" prose.
  const OPEN_LANGUAGE_FEATURE: ContentRow = {
    kind: 'feature',
    slug: 'open-language-pick',
    version: 1,
    source: 'test',
    name: 'Open Language Pick',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'test-subclass',
      minLevel: 1,
      choices: { languages: {} }
    }
  };

  it('accepts any language when allowedLanguages is omitted', () => {
    const altSubclass: ContentRow = {
      ...SYNTH_SUBCLASS,
      data: {
        ...(SYNTH_SUBCLASS.data as Record<string, unknown>),
        subclassFeatures: [{ level: 1, name: 'Open Language Pick' }]
      }
    };
    const rows: ContentRow[] = [SYNTH_CLASS, altSubclass, OPEN_LANGUAGE_FEATURE, SYNTH_SPECIES];
    const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
    const lookup: ContentLookup = (ref) => map.get(`${ref.kind}/${ref.slug}`);
    const char = baseCharacter({
      'open-language-pick': { languages: [{ language: 'something-homebrew' }] }
    });
    const d = derive(char, lookup);
    expect(d.stats.languages).toContain('something-homebrew');
  });
});
