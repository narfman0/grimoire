// Minimal mount model — `appliesToMount: true` scopes a modifier to the
// character's mount instead of the character, mirroring `appliesToForm`.
// Horseshoes of speed raise the MOUNT's walking speed, not the rider's.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

const HORSESHOES_OF_SPEED: ContentRow = {
  kind: 'item',
  slug: 'test-horseshoes-of-speed',
  version: 1,
  name: 'Horseshoes of Speed',
  source: 'test',
  data: {
    category: 'wondrous',
    modifiers: [
      {
        kind: 'stat-modifier',
        name: 'Horseshoes of Speed',
        target: 'speed.walk',
        mode: 'ADD',
        value: 30,
        appliesToMount: true
      }
    ]
  }
};

const HORSESHOES_OF_A_ZEPHYR: ContentRow = {
  kind: 'item',
  slug: 'test-horseshoes-of-a-zephyr',
  version: 1,
  name: 'Horseshoes of a Zephyr',
  source: 'test',
  data: {
    category: 'wondrous',
    modifiers: [
      {
        kind: 'stat-modifier',
        name: 'Horseshoes of a Zephyr',
        target: 'trait.no-fall-damage',
        value: true,
        appliesToMount: true
      },
      {
        kind: 'stat-modifier',
        name: 'Horseshoes of a Zephyr',
        target: 'trait.ignore-difficult-terrain',
        value: true,
        appliesToMount: true
      }
    ]
  }
};

const WARHORSE: ContentRow = {
  kind: 'monster',
  slug: 'test-warhorse',
  version: 1,
  name: 'Warhorse',
  source: 'test',
  data: { size: 'large', ac: 11, hp: { average: 19 }, speed: { walk: 60 } }
};

function char(itemSlugs: string[]): CharacterDocument {
  return {
    id: 'mount-test',
    name: 'Rider',
    classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'test-human' },
    feats: [],
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: itemSlugs.map((slug) => ({
      contentKind: 'item',
      contentSlug: slug,
      equipped: true,
      attuned: false
    })),
    spells: { known: [], prepared: [] },
    currentHp: 44,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

describe('appliesToMount', () => {
  it('is empty by default', () => {
    expect(derive(char([]), lookupFor([])).mountEffects).toEqual([]);
  });

  it('keeps the modifier off the rider and surfaces it on mountEffects', () => {
    const lookup = lookupFor([HORSESHOES_OF_SPEED]);
    const bare = derive(char([]), lookup);
    const shod = derive(char([HORSESHOES_OF_SPEED.slug]), lookup);
    // The rider's own speed is untouched — the whole point of the flag.
    expect(shod.stats.speeds.walk).toBe(bare.stats.speeds.walk);
    expect(shod.mountEffects).toEqual([
      {
        sourceContent: { kind: 'item', slug: 'test-horseshoes-of-speed' },
        name: 'Horseshoes of Speed',
        modifier: expect.objectContaining({ target: 'speed.walk', mode: 'ADD', value: 30 })
      }
    ]);
  });

  it('does not leak trait flags onto the rider', () => {
    const d = derive(
      char([HORSESHOES_OF_A_ZEPHYR.slug]),
      lookupFor([HORSESHOES_OF_A_ZEPHYR])
    );
    expect(d.stats.traits).toEqual([]);
    expect(d.mountEffects).toHaveLength(2);
    expect(d.mountEffects.map((e) => e.modifier.target)).toEqual([
      'trait.no-fall-damage',
      'trait.ignore-difficult-terrain'
    ]);
  });

  it('collects across multiple sources and emits no unknown-* warning', () => {
    const d = derive(
      char([HORSESHOES_OF_SPEED.slug, HORSESHOES_OF_A_ZEPHYR.slug]),
      lookupFor([HORSESHOES_OF_SPEED, HORSESHOES_OF_A_ZEPHYR])
    );
    expect(d.mountEffects).toHaveLength(3);
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });
});

describe('CompanionState.isMount', () => {
  it('mirrors onto the derived companion snapshot', () => {
    const c = char([]);
    c.companions = [
      {
        slug: WARHORSE.slug,
        name: 'Bayard',
        sourceContent: { kind: 'item', slug: 'test-saddle' },
        currentHp: 19,
        maxHp: 19,
        status: 'summoned',
        isMount: true
      },
      {
        slug: WARHORSE.slug,
        name: 'Not a mount',
        sourceContent: { kind: 'item', slug: 'test-saddle' },
        currentHp: 19,
        maxHp: 19,
        status: 'summoned'
      }
    ];
    const d = derive(c, lookupFor([WARHORSE]));
    expect(d.companions?.map((x) => x.isMount)).toEqual([true, false]);
  });
});
