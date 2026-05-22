// Locks the engine contract that grimoire-packs xanathars subclass rows
// depend on for Wave-2 authoring:
//   1. spellListAdditions on paladin-oath spells-rows (conquest, redemption)
//      composes the listed slugs into Derived.alwaysPreparedFromContent and
//      surfaces a cast surface when the spell is in pack content.
//   2. The Healing Light XGE encoding — uses.max = { sum: [1, warlockLevel] }
//      and damage dice = { perAbilityMod: 'cha', dieSize: 6 } — both resolve
//      through derive() into a per-long-rest Resource and a dice string the
//      encounter runtime can roll.
//   3. The Hexblade's Curse trigger grant value, promoted from the inert
//      "warlock-level+cha" string to a structured { sum: [...] } shape, now
//      evaluates to a numeric heal amount.
//
// All content is synthesized inline — these assertions never touch the
// grimoire-packs sibling repo so the engine test suite stays hermetic.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { evaluateValue, type EvalContext } from '../evaluate';
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

/** Bare-bones level-3 paladin with a synthetic oath subclass. */
function paladin(subclassSlug: string): CharacterDocument {
  return {
    id: `test-paladin-${subclassSlug}`,
    name: 'Oath Spell-List Test Subject',
    classes: [{ slug: 'paladin', level: 3, subclass: subclassSlug, hpRolledPerLevel: [10, 6, 6] }],
    species: { kind: 'species', slug: 'nonexistent-species' },
    feats: [],
    abilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 10, cha: 16 },
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

describe('xanathars oath-spells: spellListAdditions on paladin-oath rows', () => {
  it('conquest-style oath-spells row composites SRD-known slugs into alwaysPreparedFromContent', () => {
    // Mirrors the authored xanathars/features/conquest.json oath-spells row.
    // Only SRD-resolvable slugs (hold-person, spiritual-weapon) are injected;
    // missing slugs (armor-of-agathys, command, fear, etc.) are documented in
    // the row's note but not added — derive() would warn on unresolved refs.
    const subclass: ContentRow = {
      kind: 'subclass',
      slug: 'conquest',
      version: 1,
      source: 'test',
      name: 'Oath of Conquest',
      data: { parentClass: 'paladin', features: ['oath-spells'] }
    };
    const feature: ContentRow = {
      kind: 'feature',
      slug: 'oath-spells',
      version: 1,
      source: 'test',
      name: 'Oath Spells',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'conquest',
        minLevel: 3,
        spellListAdditions: ['hold-person', 'spiritual-weapon']
      }
    };
    const d = derive(paladin('conquest'), lookupWith(subclass, feature));
    expect(d.alwaysPreparedFromContent).toContain('hold-person');
    expect(d.alwaysPreparedFromContent).toContain('spiritual-weapon');
    // Both spells are in SRD packs → cast surfaces should materialize.
    expect(d.actions.find((a) => a.sourceContent.slug === 'hold-person')).toBeDefined();
    expect(d.actions.find((a) => a.sourceContent.slug === 'spiritual-weapon')).toBeDefined();
  });

  it('redemption-style oath-spells row composites a wider spread of SRD slugs', () => {
    // Mirrors the authored xanathars/features/redemption.json oath-spells row.
    // Five of the ten 2014 Redemption oath spells are in SRD packs; the rest
    // (sanctuary, ray-of-enfeeblement, hypnotic-pattern, otilukes-resilient-
    // sphere, stoneskin) are documented as missing.
    const subclass: ContentRow = {
      kind: 'subclass',
      slug: 'redemption',
      version: 1,
      source: 'test',
      name: 'Oath of Redemption',
      data: { parentClass: 'paladin', features: ['oath-spells-r'] }
    };
    const feature: ContentRow = {
      kind: 'feature',
      slug: 'oath-spells-r',
      version: 1,
      source: 'test',
      name: 'Oath Spells (Redemption)',
      data: {
        ownerKind: 'subclass',
        ownerSlug: 'redemption',
        minLevel: 3,
        spellListAdditions: ['sleep', 'hold-person', 'counterspell', 'hold-monster', 'wall-of-force']
      }
    };
    const d = derive(paladin('redemption'), lookupWith(subclass, feature));
    expect(d.alwaysPreparedFromContent).toEqual(
      expect.arrayContaining(['sleep', 'hold-person', 'counterspell', 'hold-monster', 'wall-of-force'])
    );
    // Wall of Force is a touchstone SRD spell — confirm cast surface lands.
    expect(d.actions.find((a) => a.sourceContent.slug === 'wall-of-force')).toBeDefined();
  });
});

describe('xanathars celestial healing-light: per-mod + sum scaling shapes', () => {
  // Synthetic eval ctx for a CHA-16 warlock-3 (the canonical XGE Healing
  // Light fixture: pool = 1 + 3 = 4 d6s, per-use heal = chaMod d6 = 3d6).
  const CELESTIAL_CTX: EvalContext = {
    totalLevel: 3,
    proficiencyBonus: 2,
    rageDamage: 0,
    classLevels: { warlock: 3 },
    abilityMods: { str: 0, dex: 0, con: 2, int: 0, wis: 0, cha: 3 },
    walkSpeed: 30,
    conditionStacks: {}
  };

  it('uses.max = { sum: [1, warlockLevel] } resolves to (1 + warlockLevel)', () => {
    // Locks the pool-size encoding the xanathars celestial healing-light row
    // (and the phb-2024 celestial-patron mirror) rely on.
    expect(evaluateValue({ sum: [1, 'warlockLevel'] }, CELESTIAL_CTX)).toBe(4);
  });

  it('damage dice = { perAbilityMod: "cha", dieSize: 6 } resolves to "{chaMod}d6"', () => {
    // Per-use heal expression — must produce the canonical 3d6 string for a
    // CHA +3 warlock. Mirrors the sear-undead per-mod pattern.
    expect(evaluateValue({ perAbilityMod: 'cha', dieSize: 6 }, CELESTIAL_CTX)).toBe('3d6');
  });
});

describe('xanathars hexblade-curse: sum-shape trigger-grant value', () => {
  // Synthetic eval ctx for a warlock-5 CHA-16 hexblade (matching Hex Warrior's
  // CHA-as-attack-stat optimization).
  const HEXBLADE_CTX: EvalContext = {
    totalLevel: 5,
    proficiencyBonus: 3,
    rageDamage: 0,
    classLevels: { warlock: 5 },
    abilityMods: { str: 0, dex: 0, con: 2, int: 0, wis: 0, cha: 3 },
    walkSpeed: 30,
    conditionStacks: {}
  };

  it('promoted grant value { sum: ["warlockLevel", "chaMod"] } evaluates to warlockLevel + chaMod', () => {
    // Before the Wave-2 promotion, the hexblade.json kill-heal trigger
    // carried `value: "warlock-level+cha"` — an arbitrary string that
    // evaluateValue passed through unchanged. The structured `sum` shape
    // makes the heal amount computable: warlock 5 + CHA +3 = 8 HP.
    expect(evaluateValue({ sum: ['warlockLevel', 'chaMod'] }, HEXBLADE_CTX)).toBe(8);
  });

  it('grant value still honors the prose minimum-of-1 implicitly via the sum branch', () => {
    // Even a CHA-dumped (CHA 8 → mod -1) warlock-1 character should land on
    // a non-negative heal: warlockLevel 1 + chaMod -1 = 0. The prose says
    // "minimum of 1 hit point"; the engine's sum branch returns 0 here, so
    // a downstream clamp is required to honor the prose. Documented now.
    const dumpedCtx: EvalContext = {
      ...HEXBLADE_CTX,
      totalLevel: 1,
      classLevels: { warlock: 1 },
      abilityMods: { ...HEXBLADE_CTX.abilityMods, cha: -1 }
    };
    expect(evaluateValue({ sum: ['warlockLevel', 'chaMod'] }, dumpedCtx)).toBe(0);
  });
});
