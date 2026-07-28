// `appliesWhen.circumstances` — state gates the condition-slug channel
// could not express. Computed members (hp.* / wielding.* / armor.*) are
// evaluated by derive(); everything else is DM-adjudicated and rides a
// default-off toggle.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import { hpCircumstances, readCircumstances, adjudicatedCircumstances } from '../circumstances';
import type { CharacterDocument, ContentRow } from '../types';

const GREATSWORD: ContentRow = {
  kind: 'item',
  slug: 'test-greatsword',
  version: 1,
  name: 'Greatsword',
  source: 'test',
  data: {
    category: 'weapon',
    weaponType: 'martial-melee',
    damage: '2d6',
    damageType: 'slashing',
    properties: ['heavy', 'two-handed']
  }
};

const SHORTBOW: ContentRow = {
  kind: 'item',
  slug: 'test-shortbow',
  version: 1,
  name: 'Shortbow',
  source: 'test',
  data: {
    category: 'weapon',
    weaponType: 'simple-ranged',
    damage: '1d6',
    damageType: 'piercing',
    properties: ['ammunition', 'two-handed']
  }
};

const CHAIN_MAIL: ContentRow = {
  kind: 'item',
  slug: 'test-chain-mail',
  version: 1,
  name: 'Chain Mail',
  source: 'test',
  data: { category: 'armor', armorType: 'heavy', ac: { base: 16 } }
};

function char(
  featSlugs: string[],
  opts: { items?: string[]; currentHp?: number; toggles?: Record<string, boolean> } = {}
): CharacterDocument {
  return {
    id: 'circumstance-test',
    name: 'Circumstantial',
    classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: (opts.items ?? []).map((slug) => ({
      contentKind: 'item',
      contentSlug: slug,
      equipped: true,
      attuned: false
    })),
    spells: { known: [], prepared: [] },
    currentHp: opts.currentHp ?? 44,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: opts.toggles ?? {}
  };
}

function featRow(slug: string, data: Record<string, unknown>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

/** A feat whose only payload is a +2 initiative bonus gated on
 *  `circumstances`. Initiative is a plain numeric target with no other
 *  contributors, so the assertion is unambiguous. */
function gatedInitiativeFeat(slug: string, circumstances: string[]): ContentRow {
  return featRow(slug, {
    modifiers: [
      {
        kind: 'stat-modifier',
        name: slug,
        target: 'initiative',
        mode: 'ADD',
        value: 2,
        appliesWhen: { circumstances }
      }
    ]
  });
}

describe('unit helpers', () => {
  it('normalizes singular and plural authoring', () => {
    expect(readCircumstances({ circumstance: 'hp.below-half' })).toEqual(['hp.below-half']);
    expect(readCircumstances({ circumstances: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(readCircumstances(undefined)).toEqual([]);
  });

  it('classifies adjudicated vs computed vs misspelled', () => {
    expect(
      adjudicatedCircumstances({
        circumstances: ['hp.below-half', 'no-allies-within-10ft', 'hp.half']
      })
    ).toEqual(['no-allies-within-10ft']);
  });

  it('computes the HP bands off current vs max', () => {
    expect(hpCircumstances(10, 40)).toEqual(['hp.below-half', 'hp.at-or-below-half', 'hp.bloodied']);
    expect(hpCircumstances(40, 40)).toEqual(['hp.above-half', 'hp.full']);
    expect(hpCircumstances(20, 40)).toEqual(['hp.at-or-below-half', 'hp.bloodied']);
    expect(hpCircumstances(5, 0)).toEqual([]);
  });
});

describe('computed circumstance gates', () => {
  it('fires an hp.below-half gate only below half HP', () => {
    const feat = gatedInitiativeFeat('test-below-half', ['hp.below-half']);
    const lookup = lookupFor([feat]);
    const healthy = derive(char([feat.slug], { currentHp: 44 }), lookup);
    const hurt = derive(char([feat.slug], { currentHp: 10 }), lookup);
    expect(healthy.stats.initiative).toBe(hurt.stats.initiative - 2);
  });

  it('fires a wielding.two-handed gate only with a two-handed weapon equipped', () => {
    const feat = gatedInitiativeFeat('test-two-handed', ['wielding.two-handed']);
    const lookup = lookupFor([feat, GREATSWORD, CHAIN_MAIL]);
    const empty = derive(char([feat.slug]), lookup);
    const armed = derive(char([feat.slug], { items: [GREATSWORD.slug] }), lookup);
    expect(armed.stats.initiative).toBe(empty.stats.initiative + 2);
  });

  it('fires a wielding.ranged-weapon gate only with a ranged weapon equipped', () => {
    const feat = gatedInitiativeFeat('test-ranged', ['wielding.ranged-weapon']);
    const lookup = lookupFor([feat, GREATSWORD, SHORTBOW]);
    const melee = derive(char([feat.slug], { items: [GREATSWORD.slug] }), lookup);
    const ranged = derive(char([feat.slug], { items: [SHORTBOW.slug] }), lookup);
    expect(ranged.stats.initiative).toBe(melee.stats.initiative + 2);
  });

  it('fires armor.none / armor.heavy against equipped body armor', () => {
    const unarmored = gatedInitiativeFeat('test-unarmored', ['armor.none']);
    const heavy = gatedInitiativeFeat('test-heavy', ['armor.heavy']);
    const lookup = lookupFor([unarmored, heavy, CHAIN_MAIL]);
    const bare = derive(char([unarmored.slug, heavy.slug]), lookup);
    const clad = derive(char([unarmored.slug, heavy.slug], { items: [CHAIN_MAIL.slug] }), lookup);
    // Exactly one of the two feats applies in each case.
    expect(clad.stats.initiative).toBe(bare.stats.initiative);
    const none = derive(char([]), lookup);
    expect(bare.stats.initiative).toBe(none.stats.initiative + 2);
  });

  it('requires EVERY computed circumstance in the list', () => {
    const feat = gatedInitiativeFeat('test-both', ['hp.below-half', 'wielding.two-handed']);
    const lookup = lookupFor([feat, GREATSWORD]);
    const base = derive(char([]), lookup).stats.initiative;
    expect(derive(char([feat.slug], { currentHp: 10 }), lookup).stats.initiative).toBe(base);
    expect(
      derive(char([feat.slug], { currentHp: 10, items: [GREATSWORD.slug] }), lookup).stats.initiative
    ).toBe(base + 2);
  });
});

describe('adjudicated circumstance gates', () => {
  it('defaults off, surfaces as a toggle, and applies once switched on', () => {
    const feat = gatedInitiativeFeat('test-no-allies', ['no-allies-within-10ft']);
    const lookup = lookupFor([feat]);
    const off = derive(char([feat.slug]), lookup);
    const base = derive(char([]), lookup).stats.initiative;
    expect(off.stats.initiative).toBe(base);

    const toggle = off.toggles.find((t) => t.sourceContent.slug === feat.slug);
    expect(toggle).toBeDefined();
    expect(toggle!.adjudicated).toBe(true);
    expect(toggle!.defaultEnabled).toBe(false);
    expect(toggle!.circumstances).toEqual(['no-allies-within-10ft']);

    const on = derive(char([feat.slug], { toggles: { [toggle!.id]: true } }), lookup);
    expect(on.stats.initiative).toBe(base + 2);
  });

  it('an explicit defaultEnabled still wins', () => {
    const feat = featRow('test-default-on', {
      modifiers: [
        {
          kind: 'stat-modifier',
          name: 'always',
          target: 'initiative',
          mode: 'ADD',
          value: 2,
          defaultEnabled: true,
          appliesWhen: { circumstances: ['while-impersonating'] }
        }
      ]
    });
    const lookup = lookupFor([feat]);
    const base = derive(char([]), lookup).stats.initiative;
    expect(derive(char([feat.slug]), lookup).stats.initiative).toBe(base + 2);
  });

  it('combines with a computed member — toggle on but circumstance false still blocks', () => {
    const feat = gatedInitiativeFeat('test-mixed', ['hp.below-half', 'hidden-from-target']);
    const lookup = lookupFor([feat]);
    const base = derive(char([]), lookup).stats.initiative;
    const probe = derive(char([feat.slug]), lookup);
    const id = probe.toggles.find((t) => t.sourceContent.slug === feat.slug)!.id;
    expect(derive(char([feat.slug], { toggles: { [id]: true } }), lookup).stats.initiative).toBe(
      base
    );
    expect(
      derive(char([feat.slug], { toggles: { [id]: true }, currentHp: 10 }), lookup).stats.initiative
    ).toBe(base + 2);
  });
});

describe('action modifiers and validation', () => {
  it('gates an action-modifier on a computed circumstance', () => {
    const feat = featRow('test-colossus-slayer', {
      activities: [
        {
          id: 'strike',
          name: 'Strike',
          type: 'damage',
          cost: 'action',
          damage: { parts: [{ dice: '1d8', type: 'slashing' }] }
        }
      ],
      modifiers: [
        {
          kind: 'action-modifier',
          id: 'test-colossus-slayer-mod',
          name: 'Colossus Slayer',
          appliesWhen: { circumstances: ['wielding.two-handed'] },
          effects: [{ target: 'damage.dice', value: '1d8', damageType: 'slashing' }]
        }
      ]
    });
    const lookup = lookupFor([feat, GREATSWORD]);
    const bare = derive(char([feat.slug]), lookup).actions.find((a) => a.name === 'Strike')!;
    const armed = derive(char([feat.slug], { items: [GREATSWORD.slug] }), lookup).actions.find(
      (a) => a.name === 'Strike'
    )!;
    expect(bare.damageRolls).toHaveLength(1);
    expect(armed.damageRolls).toHaveLength(2);
  });

  it('warns on a misspelled member of a computed namespace, without unknown-*', () => {
    const feat = gatedInitiativeFeat('test-typo', ['hp.half']);
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const issue = d.validations.find((v) => v.code === 'circumstance-unrecognized');
    expect(issue?.message).toContain('hp.half');
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
    // A typo is not an adjudication: no toggle is minted for it.
    expect(d.toggles.find((t) => t.sourceContent.slug === feat.slug)).toBeUndefined();
  });

  it('does not warn on an ordinary adjudicated circumstance', () => {
    const feat = gatedInitiativeFeat('test-adjudicated', ['target-is-your-hunters-mark-target']);
    const d = derive(char([feat.slug]), lookupFor([feat]));
    expect(d.validations.filter((v) => v.code === 'circumstance-unrecognized')).toEqual([]);
  });
});
