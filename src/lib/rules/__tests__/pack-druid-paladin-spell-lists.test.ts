// Locks the engine contract that grimoire-packs phb-2024 druid-circle and
// paladin-oath subclass-spells rows depend on: a feature row whose data
// carries `spellListAdditions` injects those spell slugs into
// Derived.alwaysPreparedFromContent so the UI labels them, AND queues each
// slug for deferred ref resolution so the spell's cast action appears on
// the sheet (when the spell row is in pack content). Mirrors the SRD
// life-domain-spells / fiend-spells pattern in content-packs/srd-5.2.
//
// Tests run with the SRD content-packs loaded but synthesize the subclass +
// feature rows inline via lookupWithOverrides — they do not depend on the
// grimoire-packs sibling repo being available.
//
// Reference patterns:
//   src/lib/rules/__tests__/mechanics.test.ts:347 (fey-touched test)
//   src/lib/rules/__tests__/homebrew-feat.test.ts (lookupWithHomebrew)

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

/** Overlay arbitrary synthetic rows on top of the SRD packs lookup. */
function lookupWith(...rows: ContentRow[]): ContentLookup {
  const overlay = new Map<string, ContentRow>();
  for (const r of rows) overlay.set(`${r.kind}/${r.slug}`, r);
  return (ref) =>
    overlay.get(`${ref.kind}/${ref.slug}`) ?? PACKS.get(`${ref.kind}/${ref.slug}`);
}

/** Bare-bones level-3 character of the given class with a synthetic subclass.
 *  Skips species/background so the test doesn't depend on phb-2014 / phb-2024. */
function character(classSlug: string, subclassSlug: string): CharacterDocument {
  return {
    id: `test-${classSlug}-${subclassSlug}`,
    name: 'Spell-List Test Subject',
    classes: [{ slug: classSlug, level: 3, subclass: subclassSlug, hpRolledPerLevel: [10, 6, 6] }],
    species: { kind: 'species', slug: 'nonexistent-species' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 14, cha: 14 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 22,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

describe('spellListAdditions on druid-circle + paladin-oath features', () => {
  it('druid-circle-style: feature with spellListAdditions composes into alwaysPreparedFromContent', () => {
    const subclass: ContentRow = {
      kind: 'subclass',
      slug: 'circle-of-the-tide-pool',
      version: 1,
      source: 'test',
      name: 'Circle of the Tide Pool',
      data: { parentClass: 'druid', features: ['tide-pool-spells'] }
    };
    const feature: ContentRow = {
      kind: 'feature',
      slug: 'tide-pool-spells',
      version: 1,
      source: 'test',
      name: 'Tide Pool Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'circle-of-the-tide-pool',
        minLevel: 3,
        spellListAdditions: ['cure-wounds', 'faerie-fire', 'wall-of-fire']
      }
    };
    const char = character('druid', 'circle-of-the-tide-pool');
    const d = derive(char, lookupWith(subclass, feature));
    expect(d.alwaysPreparedFromContent).toContain('cure-wounds');
    expect(d.alwaysPreparedFromContent).toContain('faerie-fire');
    expect(d.alwaysPreparedFromContent).toContain('wall-of-fire');
    // Cure Wounds is in SRD packs, so a cast surface should materialise.
    expect(d.actions.find((a) => a.sourceContent.slug === 'cure-wounds')).toBeDefined();
  });

  it('paladin-oath-style: feature with spellListAdditions composes into alwaysPreparedFromContent', () => {
    const subclass: ContentRow = {
      kind: 'subclass',
      slug: 'oath-of-the-thunderhead',
      version: 1,
      source: 'test',
      name: 'Oath of the Thunderhead',
      data: { parentClass: 'paladin', features: ['thunderhead-spells'] }
    };
    const feature: ContentRow = {
      kind: 'feature',
      slug: 'thunderhead-spells',
      version: 1,
      source: 'test',
      name: 'Thunderhead Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'oath-of-the-thunderhead',
        minLevel: 3,
        spellListAdditions: ['misty-step', 'hold-person', 'haste']
      }
    };
    const char = character('paladin', 'oath-of-the-thunderhead');
    const d = derive(char, lookupWith(subclass, feature));
    expect(d.alwaysPreparedFromContent).toContain('misty-step');
    expect(d.alwaysPreparedFromContent).toContain('hold-person');
    expect(d.alwaysPreparedFromContent).toContain('haste');
    // Haste is in SRD packs, so a cast surface should materialise.
    expect(d.actions.find((a) => a.sourceContent.slug === 'haste')).toBeDefined();
  });

  it('gracefully skips spell slugs that are not in pack content (no cast surface, no crash)', () => {
    // moonbeam / pass-without-trace / scrying are on the 2024 PHB tables but
    // are NOT in content-packs/srd-5.2/spells. derive() should still complete,
    // the slug should still surface on alwaysPreparedFromContent (so the UI
    // can label "always prepared from subclass"), and no action row should
    // exist for the missing spell.
    const subclass: ContentRow = {
      kind: 'subclass',
      slug: 'circle-of-the-test-void',
      version: 1,
      source: 'test',
      name: 'Circle of the Test Void',
      data: { parentClass: 'druid', features: ['test-void-spells'] }
    };
    const feature: ContentRow = {
      kind: 'feature',
      slug: 'test-void-spells',
      version: 1,
      source: 'test',
      name: 'Test Void Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'circle-of-the-test-void',
        minLevel: 3,
        spellListAdditions: ['moonbeam', 'pass-without-trace', 'cure-wounds']
      }
    };
    const char = character('druid', 'circle-of-the-test-void');
    const d = derive(char, lookupWith(subclass, feature));
    expect(d.alwaysPreparedFromContent).toContain('moonbeam');
    expect(d.alwaysPreparedFromContent).toContain('pass-without-trace');
    expect(d.alwaysPreparedFromContent).toContain('cure-wounds');
    // The missing spells have no cast surface — graceful degradation.
    expect(d.actions.find((a) => a.sourceContent.slug === 'moonbeam')).toBeUndefined();
    expect(d.actions.find((a) => a.sourceContent.slug === 'pass-without-trace')).toBeUndefined();
    // But the in-SRD spell still resolves.
    expect(d.actions.find((a) => a.sourceContent.slug === 'cure-wounds')).toBeDefined();
  });
});
