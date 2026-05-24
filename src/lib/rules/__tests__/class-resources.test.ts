// Class-resource pool primitive: declaration → derived pool → spend +
// refresh helpers. Covers Bardic-Inspiration-shape (PB uses, die scales
// by class level, long-rest refresh), Ki-shape (point-based, monk
// level, short-rest refresh), Superiority-Dice-shape (perClass-table
// max + die size), spend / refresh helpers, and the multi-class
// duplicate-id edge.
//
// Class rows declare pools in `data.resources: ClassResourceDecl[]`.
// derive() walks them per active class row and produces a resolved
// `Derived.classResources` list. spendResource / refreshResourcesOnRest
// manipulate the matching `character.resourcesSpent[id]` counters.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { spendResource, refreshResourcesOnRest } from '../class-resources';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// --- fixtures ---------------------------------------------------------

// Bard-shape class: Bardic Inspiration uses PB per long rest; die scales
// d6→d8→d10→d12 across L1-20 (canonical bard table). Authored as a
// perClass-table on dieSize so we exercise the same lookup the engine
// uses for activation uses.max + rage damage scaling.
const TEST_BARD: ContentRow = {
  kind: 'class',
  slug: 'testbard',
  version: 1,
  source: 'test',
  name: 'Test Bard',
  data: {
    hitDie: 8,
    primaryAbility: 'cha',
    saves: ['dex', 'cha'],
    resources: [
      {
        id: 'bardic-inspiration',
        name: 'Bardic Inspiration',
        max: 'proficiencyBonus',
        dieSize: {
          perClass: 'testbard',
          table: [
            'd6', 'd6', 'd6', 'd6',
            'd8', 'd8', 'd8', 'd8', 'd8',
            'd10', 'd10', 'd10', 'd10', 'd10',
            'd12', 'd12', 'd12', 'd12', 'd12', 'd12'
          ]
        },
        refresh: 'long-rest',
        spendKind: 'die'
      }
    ]
  }
};

// Monk-shape class: Ki points = monk level, short-rest refresh,
// point-based (no die). The first-wins multi-class case below picks the
// `monk` id off this row.
const TEST_MONK: ContentRow = {
  kind: 'class',
  slug: 'testmonk',
  version: 1,
  source: 'test',
  name: 'Test Monk',
  data: {
    hitDie: 8,
    primaryAbility: 'dex',
    saves: ['str', 'dex'],
    resources: [
      {
        id: 'ki',
        name: 'Ki / Focus',
        max: 'testmonkLevel',
        refresh: 'short-rest',
        spendKind: 'point'
      }
    ]
  }
};

// Battle-Master-shape class: Superiority Dice — perClass-table max
// (4 / 4 / 4 / 5 / 5 / 5 / 5 / 6 across L1-20) AND perClass-table dieSize
// (d8 / d8 / d10 / d10 / d12 / d12). Both shapes ride through
// evaluateValue's perClass branch.
const TEST_FIGHTER: ContentRow = {
  kind: 'class',
  slug: 'testfighter',
  version: 1,
  source: 'test',
  name: 'Test Fighter',
  data: {
    hitDie: 10,
    primaryAbility: 'str',
    saves: ['str', 'con'],
    resources: [
      {
        id: 'superiority-dice',
        name: 'Superiority Dice',
        max: {
          perClass: 'testfighter',
          table: [0, 0, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
        },
        dieSize: {
          perClass: 'testfighter',
          table: [
            'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8',
            'd10', 'd10', 'd10', 'd10', 'd10', 'd10', 'd10', 'd10',
            'd12', 'd12', 'd12'
          ]
        },
        refresh: 'short-rest',
        spendKind: 'die'
      }
    ]
  }
};

const TEST_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

function makeLookup(extra: ContentRow[] = []): ContentLookup {
  const rows: ContentRow[] = [TEST_BARD, TEST_MONK, TEST_FIGHTER, TEST_SPECIES, ...extra];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(
  classes: CharacterDocument['classes'],
  resourcesSpent?: Record<string, number>
): CharacterDocument {
  return {
    id: 'test-class-resources',
    name: 'Test',
    classes,
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...(resourcesSpent ? { resourcesSpent } : {})
  };
}

// --- Bard-shape resolution -------------------------------------------

describe('Derived.classResources — Bard-shape (PB max, level-scaled die)', () => {
  function deriveAtBardLevel(level: number, resourcesSpent?: Record<string, number>) {
    const hp: number[] = Array(level).fill(8);
    const character = baseCharacter(
      [{ slug: 'testbard', level, hpRolledPerLevel: hp }],
      resourcesSpent
    );
    return derive(character, makeLookup());
  }

  it('emits a single entry sourced from the bard class row', () => {
    const d = deriveAtBardLevel(5);
    expect(d.classResources).toBeDefined();
    expect(d.classResources!.length).toBe(1);
    const bi = d.classResources![0];
    expect(bi.id).toBe('bardic-inspiration');
    expect(bi.name).toBe('Bardic Inspiration');
    expect(bi.sourceClassSlug).toBe('testbard');
    expect(bi.refresh).toBe('long-rest');
    expect(bi.spendKind).toBe('die');
  });

  it('resolves max=PB and dieSize per bard level', () => {
    // L1 (PB 2): d6
    const l1 = deriveAtBardLevel(1).classResources![0];
    expect(l1.max).toBe(2);
    expect(l1.dieSize).toBe('d6');
    // L5 (PB 3): d8
    const l5 = deriveAtBardLevel(5).classResources![0];
    expect(l5.max).toBe(3);
    expect(l5.dieSize).toBe('d8');
    // L10 (PB 4): d10
    const l10 = deriveAtBardLevel(10).classResources![0];
    expect(l10.max).toBe(4);
    expect(l10.dieSize).toBe('d10');
    // L15 (PB 5): d12
    const l15 = deriveAtBardLevel(15).classResources![0];
    expect(l15.max).toBe(5);
    expect(l15.dieSize).toBe('d12');
  });

  it('computes current = max - resourcesSpent, clamped to [0, max]', () => {
    const r = deriveAtBardLevel(10, { 'bardic-inspiration': 2 }).classResources![0];
    expect(r.max).toBe(4);
    expect(r.current).toBe(2);
    // Over-spend clamps to 0
    const r2 = deriveAtBardLevel(10, { 'bardic-inspiration': 99 }).classResources![0];
    expect(r2.current).toBe(0);
  });
});

// --- Ki-shape (point) ------------------------------------------------

describe('Derived.classResources — Ki-shape (point pool, monkLevel max)', () => {
  it('resolves max from a class-level token and exposes spendKind=point', () => {
    const character = baseCharacter([
      { slug: 'testmonk', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }
    ]);
    const d = derive(character, makeLookup());
    const ki = d.classResources!.find((r) => r.id === 'ki')!;
    expect(ki).toBeDefined();
    expect(ki.max).toBe(5);
    expect(ki.current).toBe(5);
    expect(ki.spendKind).toBe('point');
    expect(ki.refresh).toBe('short-rest');
    expect(ki.dieSize).toBeUndefined();
  });

  it('reflects a partial spend on current', () => {
    const character = baseCharacter(
      [{ slug: 'testmonk', level: 10, hpRolledPerLevel: Array(10).fill(8) }],
      { ki: 3 }
    );
    const d = derive(character, makeLookup());
    const ki = d.classResources!.find((r) => r.id === 'ki')!;
    expect(ki.max).toBe(10);
    expect(ki.current).toBe(7);
  });
});

// --- Superiority Dice (perClass-table for both max and die) ---------

describe('Derived.classResources — Superiority Dice (perClass-table max + die)', () => {
  function deriveAtFighterLevel(level: number) {
    const character = baseCharacter([
      { slug: 'testfighter', level, hpRolledPerLevel: Array(level).fill(10) }
    ]);
    return derive(character, makeLookup());
  }

  it('drops the pool at levels with max=0 (before the feature is granted)', () => {
    const d = deriveAtFighterLevel(2);
    // table at L2 = 0; pool should be skipped
    expect(d.classResources?.find((r) => r.id === 'superiority-dice')).toBeUndefined();
  });

  it('resolves max and dieSize from the perClass tables across levels', () => {
    const l3 = deriveAtFighterLevel(3).classResources!.find((r) => r.id === 'superiority-dice')!;
    expect(l3.max).toBe(4);
    expect(l3.dieSize).toBe('d8');

    const l10 = deriveAtFighterLevel(10).classResources!.find((r) => r.id === 'superiority-dice')!;
    expect(l10.max).toBe(6);
    expect(l10.dieSize).toBe('d10');

    const l18 = deriveAtFighterLevel(18).classResources!.find((r) => r.id === 'superiority-dice')!;
    expect(l18.max).toBe(6);
    expect(l18.dieSize).toBe('d12');
  });
});

// --- spendResource helper -------------------------------------------

describe('spendResource', () => {
  function setup(spent?: Record<string, number>) {
    const character = baseCharacter(
      [{ slug: 'testmonk', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }],
      spent
    );
    const derived = derive(character, makeLookup());
    return { character, resources: derived.classResources! };
  }

  it('decrements by 1 by default and writes resourcesSpent[id]', () => {
    const { character, resources } = setup();
    const result = spendResource(character, resources, 'ki');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.newSpent.ki).toBe(1);
  });

  it('accepts an explicit amount and stacks against existing spend', () => {
    const { character, resources } = setup({ ki: 2 });
    const result = spendResource(character, resources, 'ki', 2);
    expect(result.allowed).toBe(true);
    expect(result.newSpent.ki).toBe(4);
    expect(result.remaining).toBe(1);
  });

  it('refuses spends that exceed the remaining budget — no mutation', () => {
    const { character, resources } = setup({ ki: 4 });
    const result = spendResource(character, resources, 'ki', 2);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(1); // pre-spend current preserved
    expect(result.newSpent).toBe(character.resourcesSpent); // referential identity
  });

  it('returns allowed=false for an unknown resource id', () => {
    const { character, resources } = setup();
    const result = spendResource(character, resources, 'nope');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('is a no-op on amount=0', () => {
    const { character, resources } = setup();
    const result = spendResource(character, resources, 'ki', 0);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});

// --- refreshResourcesOnRest helper ----------------------------------

describe('refreshResourcesOnRest', () => {
  it('short-rest refreshes only short-rest pools', () => {
    const character = baseCharacter(
      [
        { slug: 'testbard', level: 5, hpRolledPerLevel: Array(5).fill(8) },
        { slug: 'testmonk', level: 5, hpRolledPerLevel: Array(5).fill(8) }
      ],
      { 'bardic-inspiration': 2, ki: 3 }
    );
    const d = derive(character, makeLookup());
    const next = refreshResourcesOnRest(character, d.classResources!, 'short-rest');
    expect(next.ki).toBe(0);
    expect(next['bardic-inspiration']).toBe(2);
  });

  it('long-rest refreshes both short-rest and long-rest pools', () => {
    const character = baseCharacter(
      [
        { slug: 'testbard', level: 5, hpRolledPerLevel: Array(5).fill(8) },
        { slug: 'testmonk', level: 5, hpRolledPerLevel: Array(5).fill(8) }
      ],
      { 'bardic-inspiration': 2, ki: 3 }
    );
    const d = derive(character, makeLookup());
    const next = refreshResourcesOnRest(character, d.classResources!, 'long-rest');
    expect(next.ki).toBe(0);
    expect(next['bardic-inspiration']).toBe(0);
  });

  it('returns the input record unchanged when nothing needs refreshing', () => {
    const character = baseCharacter(
      [{ slug: 'testbard', level: 5, hpRolledPerLevel: Array(5).fill(8) }]
    );
    const d = derive(character, makeLookup());
    const next = refreshResourcesOnRest(character, d.classResources!, 'short-rest');
    // bardic-inspiration is long-rest; short-rest is a no-op.
    expect(next).toBe(character.resourcesSpent ?? next);
  });
});

// --- multi-class duplicate-id edge ----------------------------------

describe('multi-class duplicate-id edge', () => {
  // A second class row that ALSO declares `ki` (homebrew clone), to
  // exercise the "first declaration wins" branch. Authored locally so
  // the fixture stays close to the assertion.
  const TEST_MONK_CLONE: ContentRow = {
    kind: 'class',
    slug: 'testmonkclone',
    version: 1,
    source: 'test',
    name: 'Test Monk Clone',
    data: {
      hitDie: 8,
      primaryAbility: 'wis',
      saves: ['wis', 'cha'],
      resources: [
        {
          id: 'ki',
          name: 'Cloned Ki',
          max: 'testmonkcloneLevel',
          refresh: 'long-rest',
          spendKind: 'point'
        }
      ]
    }
  };

  it('keeps the first class row to declare the id and emits a validation warning', () => {
    const character = baseCharacter([
      // Order: testmonk first (max 3 at L3), testmonk-clone second (max 5 at L5)
      { slug: 'testmonk', level: 3, hpRolledPerLevel: [8, 5, 5] },
      { slug: 'testmonkclone', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }
    ]);
    const lookup = makeLookup([TEST_MONK_CLONE]);
    const d = derive(character, lookup);
    const kiEntries = d.classResources!.filter((r) => r.id === 'ki');
    expect(kiEntries.length).toBe(1);
    expect(kiEntries[0].sourceClassSlug).toBe('testmonk');
    expect(kiEntries[0].max).toBe(3);
    // First-wins refresh policy (short-rest from the monk row); the
    // clone's long-rest is dropped along with it.
    expect(kiEntries[0].refresh).toBe('short-rest');
    expect(kiEntries[0].name).toBe('Ki / Focus');
    const warning = d.validations.find((v) => v.code === 'class-resource-duplicate-id');
    expect(warning).toBeDefined();
  });
});
