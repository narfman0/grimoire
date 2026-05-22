// Engine-side test for `spellListAdditions` on non-SRD Tasha's Cauldron of
// Everything subclass-spells rows in grimoire-packs/tashas/. The pack JSON
// authoring is exercised end-to-end elsewhere; here we lock the engine
// contract that the rows depend on: a feature row authored with
// `data.spellListAdditions` flows through derive() into
// `Derived.alwaysPreparedFromContent` when the owning subclass is active on
// the character. All content is synthesized inline so the test never
// reaches the grimoire-packs filesystem.
//
// We exercise three representative subclass shapes used by Tasha's:
//   1. Artificer-subclass spells (e.g. Artillerist, Armorer, Battle Smith,
//      Alchemist) — minLevel 3, always-prepared on the artificer chassis.
//   2. Sorcerer-origin Psionic Spells (Aberrant Mind) — minLevel 1,
//      always-known sorcerer subclass shape.
//   3. Paladin-oath spells (Oath of Glory, Oath of the Watchers) —
//      minLevel 3, classic oath-spells composition into the paladin list.
//
// References:
//   - mechanics.test.ts:347 — fey-touched feat spellListAdditions case
//   - pack-cleric-domain-spell-lists.test.ts — chronurgy-fixture overlay
//   - pack-warlock-sorcerer-spell-lists.test.ts — synthetic subclass shape

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

/** Minimal synthetic spell row — enough for derive()'s deferredRefs to
 *  resolve the spell into alwaysPreparedFromContent. */
function spellRow(slug: string, level = 1): ContentRow {
  return {
    kind: 'spell',
    slug,
    version: 1,
    source: 'test',
    name: slug,
    data: { level, school: 'evocation' }
  };
}

function packMap(rows: ContentRow[]): Map<string, ContentRow> {
  const m = new Map<string, ContentRow>();
  for (const r of rows) m.set(`${r.kind}/${r.slug}`, r);
  return m;
}

function lookupFrom(map: Map<string, ContentRow>): ContentLookup {
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

/** Trivial species row keeps content-missing warnings quiet during derive(). */
const SPECIES_ROW: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: { modifiers: [] }
};

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

function makeChar(overrides: Partial<CharacterDocument>): CharacterDocument {
  return {
    id: 'test-tashas-spell-list',
    name: 'Tasha Spell List Test',
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

describe("Tasha's subclass-spells rows → spellListAdditions composition", () => {
  it('artificer-subclass shape (Artillerist) composites SRD spells into alwaysPreparedFromContent', () => {
    // Mirrors the artillerist-spells row in tashas/features/artillerist.json
    // — ownerKind=subclass, minLevel=3, multiple spellListAdditions entries
    // from the TCoE Artillerist Spells table that resolve against SRD.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'artillerist-spells',
      version: 1,
      source: 'test',
      name: 'Artillerist Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'artillerist',
        minLevel: 3,
        spellListAdditions: ['shield', 'scorching-ray', 'fireball', 'wall-of-fire']
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'artillerist',
      version: 1,
      source: 'test',
      name: 'Artillerist',
      data: { parentClass: 'artificer', features: ['artillerist-spells'] }
    };

    const map = packMap([
      SPECIES_ROW,
      classRow('artificer'),
      subclassRow,
      featureRow,
      spellRow('shield', 1),
      spellRow('scorching-ray', 2),
      spellRow('fireball', 3),
      spellRow('wall-of-fire', 4)
    ]);
    const character = makeChar({
      classes: [
        { slug: 'artificer', level: 5, subclass: 'artillerist', hpRolledPerLevel: [8, 5, 5, 5, 5] }
      ]
    });
    const d = derive(character, lookupFrom(map));
    expect(d.alwaysPreparedFromContent).toEqual(
      expect.arrayContaining(['shield', 'scorching-ray', 'fireball', 'wall-of-fire'])
    );
  });

  it('sorcerer-origin shape (Aberrant Mind, minLevel 1) tolerates an empty additions list', () => {
    // The Aberrant Mind psionic-spells row in tashas/features/aberrant-mind.json
    // ships with `spellListAdditions: []` because every TCoE psionic spell
    // is non-SRD. Lock that the engine derives cleanly in that case: the
    // sorcerer chassis still resolves, derive() does not throw, and
    // alwaysPreparedFromContent simply does not gain entries from this row.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'psionic-spells',
      version: 1,
      source: 'test',
      name: 'Psionic Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'aberrant-mind',
        minLevel: 1,
        spellListAdditions: []
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'aberrant-mind',
      version: 1,
      source: 'test',
      name: 'Aberrant Mind',
      data: { parentClass: 'sorcerer', features: ['psionic-spells'] }
    };

    const map = packMap([SPECIES_ROW, classRow('sorcerer'), subclassRow, featureRow]);
    const character = makeChar({
      classes: [
        { slug: 'sorcerer', level: 3, subclass: 'aberrant-mind', hpRolledPerLevel: [6, 4, 4] }
      ]
    });
    const d = derive(character, lookupFrom(map));
    expect(Array.isArray(d.alwaysPreparedFromContent)).toBe(true);
  });

  it('paladin-oath shape (Oath of the Watchers) composites SRD spells into alwaysPreparedFromContent', () => {
    // Mirrors the oath-spells row in tashas/features/oath-of-the-watchers.json
    // — paladin subclass-spells variant. Counterspell, banishment, and
    // hold-monster all live in SRD and should land on the always-prepared
    // list.
    const featureRow: ContentRow = {
      kind: 'feature',
      slug: 'oath-of-the-watchers-oath-spells',
      version: 1,
      source: 'test',
      name: 'Oath Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'oath-of-the-watchers',
        minLevel: 3,
        spellListAdditions: ['detect-magic', 'counterspell', 'banishment', 'hold-monster']
      }
    };
    const subclassRow: ContentRow = {
      kind: 'subclass',
      slug: 'oath-of-the-watchers',
      version: 1,
      source: 'test',
      name: 'Oath of the Watchers',
      data: { parentClass: 'paladin', features: ['oath-of-the-watchers-oath-spells'] }
    };

    const map = packMap([
      SPECIES_ROW,
      classRow('paladin'),
      subclassRow,
      featureRow,
      spellRow('detect-magic', 1),
      spellRow('counterspell', 3),
      spellRow('banishment', 4),
      spellRow('hold-monster', 5)
    ]);
    const character = makeChar({
      classes: [
        {
          slug: 'paladin',
          level: 9,
          subclass: 'oath-of-the-watchers',
          hpRolledPerLevel: [10, 6, 6, 6, 6, 6, 6, 6, 6]
        }
      ]
    });
    const d = derive(character, lookupFrom(map));
    expect(d.alwaysPreparedFromContent).toEqual(
      expect.arrayContaining(['detect-magic', 'counterspell', 'banishment', 'hold-monster'])
    );
  });
});
