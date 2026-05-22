// Engine-side test for `spellListAdditions` on non-SRD warlock-patron and
// sorcerer-origin subclass-spells rows (grimoire-packs/phb-2024). The pack
// JSON authoring is exercised end-to-end elsewhere; here we lock the engine
// contract that the rows depend on: a feature row authored with
// `data.spellListAdditions` flows through derive() into
// `Derived.alwaysPreparedFromContent` and surfaces a spell action when the
// owning subclass is active on the character. All content is synthesized
// inline so the test never reaches the grimoire-packs filesystem.
//
// References:
//   - mechanics.test.ts:347 — fey-touched feat spellListAdditions case
//   - homebrew-feat.test.ts  — synthetic content overlay pattern

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

/** Minimal synthetic spell row — just enough that derive()'s deferredRefs
 *  resolution can find it. No activities needed for these assertions. */
function spellRow(slug: string): ContentRow {
  return {
    kind: 'spell',
    slug,
    version: 1,
    source: 'test',
    name: slug,
    data: { level: 1, school: 'evocation' }
  };
}

/** Build a content map keyed by `${kind}/${slug}`, matching how
 *  loadAllPacks() and buildContentLookup() shape their stores. */
function packMap(rows: ContentRow[]): Map<string, ContentRow> {
  const m = new Map<string, ContentRow>();
  for (const r of rows) m.set(`${r.kind}/${r.slug}`, r);
  return m;
}

function lookupFrom(map: Map<string, ContentRow>): ContentLookup {
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

/** Bare-minimum character. Single class+subclass at level 3 (the gate for
 *  patron-spells / origin-spells features). No species/feats — keeps the
 *  active-content set tight and the assertion focused on the spell-list
 *  composition path. */
function makeChar(overrides: Partial<CharacterDocument>): CharacterDocument {
  return {
    id: 'test-spell-list',
    name: 'Spell List Test',
    classes: [],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

/** Trivial species row so the species ref doesn't emit a content-missing
 *  validation warning during derive(). */
const SPECIES_ROW: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: { modifiers: [] }
};

/** Trivial class row. The engine reads the character's class level from
 *  CharacterDocument.classes[], so the class row itself just needs to
 *  exist to keep the lookup quiet. */
function classRow(slug: string): ContentRow {
  return {
    kind: 'class',
    slug,
    version: 1,
    source: 'test',
    name: slug,
    data: { features: [] }
  };
}

describe('spellListAdditions on subclass-spells feature rows', () => {
  it('warlock-patron-style row composites a spell into alwaysPreparedFromContent', () => {
    // Mirrors archfey-spells: ownerKind=subclass, minLevel=3, single
    // spellListAdditions entry. The subclass row references the feature
    // via the engine-native `features` shape.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'patron-spells-test',
      version: 1,
      source: 'test',
      name: 'Patron Spells (test)',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'test-patron',
        minLevel: 3,
        spellListAdditions: ['misty-step']
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'test-patron',
      version: 1,
      source: 'test',
      name: 'Test Patron',
      data: { parentClass: 'warlock', features: ['patron-spells-test'] }
    };

    const map = packMap([
      SPECIES_ROW,
      classRow('warlock'),
      subclassRow,
      featureRow,
      spellRow('misty-step')
    ]);
    const character = makeChar({
      classes: [{ slug: 'warlock', level: 3, subclass: 'test-patron', hpRolledPerLevel: [8, 5, 5] }]
    });
    const d = derive(character, lookupFrom(map));
    expect(d.alwaysPreparedFromContent).toContain('misty-step');
  });

  it('sorcerer-origin-style row composites a spell into alwaysPreparedFromContent', () => {
    // Mirrors draconic-spells / clockwork-spells: same shape as the
    // patron row but owned by a sorcerer subclass.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'origin-spells-test',
      version: 1,
      source: 'test',
      name: 'Origin Spells (test)',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'test-origin',
        minLevel: 3,
        spellListAdditions: ['fly']
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'test-origin',
      version: 1,
      source: 'test',
      name: 'Test Origin',
      data: { parentClass: 'sorcerer', features: ['origin-spells-test'] }
    };

    const map = packMap([
      SPECIES_ROW,
      classRow('sorcerer'),
      subclassRow,
      featureRow,
      spellRow('fly')
    ]);
    const character = makeChar({
      classes: [{ slug: 'sorcerer', level: 3, subclass: 'test-origin', hpRolledPerLevel: [6, 4, 4] }]
    });
    const d = derive(character, lookupFrom(map));
    expect(d.alwaysPreparedFromContent).toContain('fly');
  });

  it('multiple spell slugs in a single row are independently composited', () => {
    // Locks the additive behavior the real archfey/celestial/clockwork/
    // draconic rows depend on: each slug in `spellListAdditions` lands
    // on `alwaysPreparedFromContent` independently.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'multi-spell-test',
      version: 1,
      source: 'test',
      name: 'Multi Spell (test)',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'test-multi',
        minLevel: 3,
        spellListAdditions: ['misty-step', 'fly', 'wall-of-force']
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'test-multi',
      version: 1,
      source: 'test',
      name: 'Test Multi',
      data: { parentClass: 'warlock', features: ['multi-spell-test'] }
    };

    const map = packMap([
      SPECIES_ROW,
      classRow('warlock'),
      subclassRow,
      featureRow,
      spellRow('misty-step'),
      spellRow('fly'),
      spellRow('wall-of-force')
    ]);
    const character = makeChar({
      classes: [{ slug: 'warlock', level: 3, subclass: 'test-multi', hpRolledPerLevel: [8, 5, 5] }]
    });
    const d = derive(character, lookupFrom(map));
    expect(d.alwaysPreparedFromContent).toEqual(
      expect.arrayContaining(['misty-step', 'fly', 'wall-of-force'])
    );
  });
});
