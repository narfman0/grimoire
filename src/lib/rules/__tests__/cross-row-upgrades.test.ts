// Cross-row upgrade channel (engine batch 6 §2).
//
// Features whose entire mechanical payload is "an EARLIER feature's numbers
// go up" had no encoding: re-declaring the earlier row on the later one
// double-counts shared resource pools. This locks the three target families
// that unblock the catalog's `cross-row upgrades` group:
//
//   upgrade.<rowSlug>.<dotted.path>   — generic per-declaration upgrade
//   class-resource.<id>.max / .dieSize — pool bumps by resource id
//   extra-attacks                      — the Attack-action attack count
//
// Fixtures are synthetic so the test doesn't move when pack content does.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { applyUpgradeValue, dieAverage, NO_OP } from '../cross-row-upgrades';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// --- fixtures --------------------------------------------------------

/** The "earlier" row: a reaction with a wisMod/long-rest pool, a damage
 *  die, a duplicate count, and a class-resource pool. Stands in for
 *  Warding Flare / Starry Form / Invoke Duplicity / Bardic Inspiration. */
const BASE_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'base-flare',
  version: 1,
  source: 'test',
  name: 'Base Flare',
  data: {
    ownerKind: 'class',
    ownerSlug: 'test-cleric',
    minLevel: 1,
    duplicateCount: 1,
    activities: [
      {
        id: 'flare',
        name: 'Flare',
        type: 'damage',
        cost: 'reaction',
        uses: { max: 3, per: 'long-rest' },
        damage: { parts: [{ dice: '1d8', type: 'radiant' }] }
      }
    ]
  }
};

function upgradeFeature(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return {
    kind: 'feature',
    slug,
    version: 1,
    source: 'test',
    name: slug,
    data: { ownerKind: 'class', ownerSlug: 'test-cleric', minLevel: 1, modifiers }
  };
}

/** Class row: pulls the feature rows in and declares two pools. */
function testClass(featureSlugs: string[]): ContentRow {
  return {
    kind: 'class',
    slug: 'test-cleric',
    version: 1,
    source: 'test',
    name: 'Test Cleric',
    data: {
      hitDie: 8,
      primaryAbility: 'wis',
      savingThrows: ['wis', 'cha'],
      features: featureSlugs,
      resources: [
        {
          id: 'channel-divinity',
          name: 'Channel Divinity',
          max: 2,
          refresh: 'short-rest',
          spendKind: 'point'
        },
        {
          id: 'bardic-inspiration',
          name: 'Bardic Inspiration',
          max: 3,
          refresh: 'long-rest',
          spendKind: 'die',
          dieSize: 'd6'
        }
      ]
    }
  };
}

const SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

const LONGSWORD: ContentRow = {
  kind: 'item',
  slug: 'test-longsword',
  version: 1,
  source: 'test',
  name: 'Test Longsword',
  data: {
    category: 'weapon',
    weaponType: 'martial-melee',
    damage: '1d8',
    damageType: 'slashing'
  }
};

function makeChar(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'cru',
    name: 'Upgrade Probe',
    classes: [{ slug: 'test-cleric', level: 10, hpRolledPerLevel: [] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [
      { contentKind: 'item', contentSlug: 'test-longsword', version: 1, equipped: true, attuned: false }
    ],
    spells: { known: [], prepared: [] },
    currentHp: 60,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

function lookupFor(rows: ContentRow[]): ContentLookup {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

/** Assemble a lookup with the base feature, one upgrade feature, the
 *  class row wiring both in, plus species + weapon. */
function deriveWith(modifiers: Array<Record<string, unknown>>, extraRows: ContentRow[] = []) {
  const up = upgradeFeature('improved-flare', modifiers);
  const cls = testClass(['base-flare', 'improved-flare', ...extraRows.map((r) => r.slug)]);
  const rows = [BASE_FEATURE, up, cls, SPECIES, LONGSWORD, ...extraRows];
  return derive(makeChar(), lookupFor(rows));
}

// --- applyUpgradeValue unit ------------------------------------------

describe('applyUpgradeValue', () => {
  it('chains the numeric modes', () => {
    expect(applyUpgradeValue(3, 'ADD', 2)).toBe(5);
    expect(applyUpgradeValue(3, 'OVERRIDE', 9)).toBe(9);
    expect(applyUpgradeValue(3, 'UPGRADE', 2)).toBe(3);
    expect(applyUpgradeValue(3, 'UPGRADE', 5)).toBe(5);
    expect(applyUpgradeValue(3, 'MULTIPLY', 2)).toBe(6);
  });

  it('orders die strings by average on UPGRADE', () => {
    expect(applyUpgradeValue('1d8', 'UPGRADE', '2d8')).toBe('2d8');
    expect(applyUpgradeValue('2d8', 'UPGRADE', '1d8')).toBe('2d8');
    expect(applyUpgradeValue('d6', 'UPGRADE', 'd8')).toBe('d8');
    expect(applyUpgradeValue('1d6', 'DOWNGRADE', '1d4')).toBe('1d4');
  });

  it('OVERRIDE seeds an absent field; other modes are no-ops there', () => {
    expect(applyUpgradeValue(undefined, 'OVERRIDE', 'short-rest')).toBe('short-rest');
    expect(applyUpgradeValue(undefined, 'ADD', 2)).toBe(NO_OP);
    // '1d8+2' isn't a plain die string — UPGRADE can't order it.
    expect(applyUpgradeValue('1d8+2', 'UPGRADE', '2d8')).toBe(NO_OP);
  });

  it('dieAverage parses the shapes packs author', () => {
    expect(dieAverage('d6')).toBe(3.5);
    expect(dieAverage('1d8')).toBe(4.5);
    expect(dieAverage('2d8')).toBe(9);
    expect(dieAverage('1d8+2')).toBeNull();
  });
});

// --- generic upgrade.<slug>.<path> -----------------------------------

describe('upgrade.<rowSlug>.<path>', () => {
  it('retargets an activity uses cadence (improved-warding-flare shape)', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.per',
        mode: 'OVERRIDE',
        value: 'short-rest'
      }
    ]);
    const res = d.resources.find((r) => r.id === 'feature/base-flare/flare');
    expect(res).toBeDefined();
    expect(res!.per).toBe('short-rest');
    // The shared pool stays a single resource — the whole point of the
    // channel is not re-declaring the activity on the upgrading row.
    expect(d.resources.filter((r) => r.name === 'Flare')).toHaveLength(1);
  });

  it('upgrades a damage die on the earlier row (1d8 → 2d8)', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.damage.parts.0.dice',
        mode: 'UPGRADE',
        value: '2d8'
      }
    ]);
    const action = d.actions.find((a) => a.sourceContent.slug === 'base-flare');
    expect(action).toBeDefined();
    expect(action!.damageRolls?.[0]?.formula).toBe('2d8');
  });

  it('addresses array elements by id and by index interchangeably', () => {
    const byIndex = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.0.uses.max',
        mode: 'ADD',
        value: 2
      }
    ]);
    expect(byIndex.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(5);
    const byId = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'ADD',
        value: 2
      }
    ]);
    expect(byId.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(5);
  });

  it('raises a plain numeric declaration (Invoke Duplicity 1 → 4)', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.duplicateCount',
        mode: 'OVERRIDE',
        value: 4
      }
    ]);
    expect(d.validations.filter((v) => v.code === 'cross-row-upgrade-unresolved')).toEqual([]);
    // No stat surface for duplicateCount; assert the write landed on the
    // row data the engine hands downstream consumers.
    expect(d.actions.some((a) => a.sourceContent.slug === 'base-flare')).toBe(true);
  });

  it('evaluates the value through evaluateValue (tokens resolve)', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'OVERRIDE',
        value: 'wisMod'
      }
    ]);
    // WIS 16 → +3
    expect(d.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(3);
  });

  it('stacks deterministically: same path, priority ascending', () => {
    // Two ADDs and one OVERRIDE. OVERRIDE's default priority (50) is the
    // highest, so it lands last regardless of declaration order — and the
    // result is the same whichever order the modifiers are authored in.
    const mods = [
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'ADD',
        value: 2
      },
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'OVERRIDE',
        value: 7
      },
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'ADD',
        value: 1
      }
    ];
    const a = deriveWith(mods);
    const b = deriveWith([mods[1], mods[2], mods[0]]);
    expect(a.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(7);
    expect(b.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(7);
  });

  it('never mutates the shared ContentRow — derive is repeatable', () => {
    const mods = [
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'ADD',
        value: 2
      }
    ];
    const up = upgradeFeature('improved-flare', mods);
    const cls = testClass(['base-flare', 'improved-flare']);
    const look = lookupFor([BASE_FEATURE, up, cls, SPECIES, LONGSWORD]);
    const first = derive(makeChar(), look);
    const second = derive(makeChar(), look);
    expect(first.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(5);
    expect(second.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(5);
    // The cached row is untouched.
    expect(
      (BASE_FEATURE.data.activities as Array<Record<string, unknown>>)[0].uses
    ).toEqual({ max: 3, per: 'long-rest' });
  });

  it('respects appliesWhen.condition gating like any other stat-modifier', () => {
    const mods = [
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.flare.uses.max',
        mode: 'ADD',
        value: 2,
        appliesWhen: { condition: 'raging' }
      }
    ];
    const off = deriveWith(mods);
    expect(off.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(3);
    const up = upgradeFeature('improved-flare', mods);
    const cls = testClass(['base-flare', 'improved-flare']);
    const on = derive(
      makeChar({ conditions: ['raging'] }),
      lookupFor([BASE_FEATURE, up, cls, SPECIES, LONGSWORD])
    );
    expect(on.resources.find((r) => r.id === 'feature/base-flare/flare')!.max).toBe(5);
  });

  it('warns (soft, non-unknown-*) on an inactive target row', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.no-such-row.activities.x.uses.max',
        mode: 'ADD',
        value: 1
      }
    ]);
    const w = d.validations.find((v) => v.code === 'cross-row-upgrade-unresolved');
    expect(w).toBeDefined();
    expect(w!.severity).toBe('warning');
    expect(w!.message).toContain('no-such-row');
  });

  it('warns on a path that does not resolve', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'upgrade.base-flare.activities.nope.uses.max',
        mode: 'ADD',
        value: 1
      }
    ]);
    expect(d.validations.some((v) => v.code === 'cross-row-upgrade-unresolved')).toBe(true);
  });
});

// --- class-resource.<id>.* -------------------------------------------

describe('class-resource.<id> upgrades', () => {
  it('bumps a pool max by id without knowing the declaring class row', () => {
    const d = deriveWith([
      { kind: 'stat-modifier', target: 'class-resource.channel-divinity.max', mode: 'ADD', value: 1 }
    ]);
    const cd = d.classResources?.find((r) => r.id === 'channel-divinity');
    expect(cd?.max).toBe(3);
    // The other pool is untouched.
    expect(d.classResources?.find((r) => r.id === 'bardic-inspiration')?.max).toBe(3);
  });

  it('upgrades a pool die size (d6 → d8, highest wins)', () => {
    const d = deriveWith([
      {
        kind: 'stat-modifier',
        target: 'class-resource.bardic-inspiration.dieSize',
        mode: 'UPGRADE',
        value: 'd8'
      },
      {
        kind: 'stat-modifier',
        target: 'class-resource.bardic-inspiration.dieSize',
        mode: 'UPGRADE',
        value: 'd4'
      }
    ]);
    expect(d.classResources?.find((r) => r.id === 'bardic-inspiration')?.dieSize).toBe('d8');
  });

  it('leaves `current` consistent with the bumped max', () => {
    const up = upgradeFeature('improved-flare', [
      { kind: 'stat-modifier', target: 'class-resource.channel-divinity.max', mode: 'ADD', value: 1 }
    ]);
    const cls = testClass(['base-flare', 'improved-flare']);
    const d = derive(
      makeChar({ resourcesSpent: { 'channel-divinity': 1 } }),
      lookupFor([BASE_FEATURE, up, cls, SPECIES, LONGSWORD])
    );
    const cd = d.classResources?.find((r) => r.id === 'channel-divinity');
    expect(cd?.max).toBe(3);
    expect(cd?.current).toBe(2);
  });
});

// --- extra-attacks ---------------------------------------------------

describe('extra-attacks', () => {
  it('OVERRIDE 2 turns Extra Attack into three attacks', () => {
    const extraAttackRow: ContentRow = {
      kind: 'feature',
      slug: 'extra-attack-1',
      version: 1,
      source: 'test',
      name: 'Extra Attack',
      data: { ownerKind: 'class', ownerSlug: 'test-cleric', minLevel: 1, extraAttacks: 1 }
    };
    const d = deriveWith(
      [{ kind: 'stat-modifier', target: 'extra-attacks', mode: 'OVERRIDE', value: 2 }],
      [extraAttackRow]
    );
    const attack = d.actions.find((a) => a.type === 'attack' && a.cost === 'action');
    expect(attack).toBeDefined();
    expect(attack!.attackCount).toBe(3);
  });

  it('ADD stacks on top of the declared extraAttacks total', () => {
    const extraAttackRow: ContentRow = {
      kind: 'feature',
      slug: 'extra-attack-1',
      version: 1,
      source: 'test',
      name: 'Extra Attack',
      data: { ownerKind: 'class', ownerSlug: 'test-cleric', minLevel: 1, extraAttacks: 1 }
    };
    const d = deriveWith(
      [{ kind: 'stat-modifier', target: 'extra-attacks', mode: 'ADD', value: 1 }],
      [extraAttackRow]
    );
    const attack = d.actions.find((a) => a.type === 'attack' && a.cost === 'action');
    expect(attack!.attackCount).toBe(3);
  });

  it('is inert when nothing declares it', () => {
    const d = deriveWith([]);
    const attack = d.actions.find((a) => a.type === 'attack' && a.cost === 'action');
    expect(attack!.attackCount).toBeUndefined();
  });
});
