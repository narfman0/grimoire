// Spell-parameter modifiers and alternative-cost casting — the
// `kind: 'spell-modifier'` channel. Metamagic, component waivers,
// damage-type substitution, range bumps, ritual-only flags.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

const FIREBALL: ContentRow = {
  kind: 'spell',
  slug: 'test-fireball',
  version: 1,
  name: 'Test Fireball',
  source: 'test',
  data: {
    level: 3,
    school: 'evocation',
    range: { value: 150, units: 'ft' },
    components: ['v', 's', 'm'],
    activities: [
      {
        id: 'cast',
        name: 'Test Fireball',
        type: 'save',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: { parts: [{ dice: '8d6', type: 'fire' }] }
      }
    ]
  }
};

const MINOR_ILLUSION: ContentRow = {
  kind: 'spell',
  slug: 'test-minor-illusion',
  version: 1,
  name: 'Test Minor Illusion',
  source: 'test',
  data: {
    level: 0,
    school: 'illusion',
    range: { value: 30, units: 'ft' },
    components: ['s', 'm'],
    activities: [{ id: 'cast', name: 'Test Minor Illusion', type: 'utility', cost: 'action' }]
  }
};

const BEAST_SENSE: ContentRow = {
  kind: 'spell',
  slug: 'test-beast-sense',
  version: 1,
  name: 'Test Beast Sense',
  source: 'test',
  data: {
    level: 2,
    school: 'divination',
    range: { units: 'touch' },
    activities: [{ id: 'cast', name: 'Test Beast Sense', type: 'utility', cost: 'action' }]
  }
};

function char(featSlugs: string[], spellSlugs: string[]): CharacterDocument {
  return {
    id: 'spell-mod-test',
    name: 'Parameterizer',
    classes: [{ slug: 'sorcerer', level: 6, hpRolledPerLevel: [6, 4, 4, 4, 4, 4] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 18 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: {
      known: spellSlugs.map((slug) => ({ kind: 'spell', slug })),
      prepared: spellSlugs
    },
    currentHp: 32,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featRow(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data: { modifiers } };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

function spellAction(d: ReturnType<typeof derive>, name: string) {
  return d.actions.find((a) => a.name === name)!;
}

describe('the manifest', () => {
  it('is empty by default', () => {
    expect(derive(char([], []), lookupFor([])).spellModifiers).toEqual([]);
  });

  it('collects an entry with its cost, predicate and optional flag', () => {
    const feat = featRow('test-subtle-spell', [
      {
        kind: 'spell-modifier',
        id: 'subtle-spell',
        name: 'Subtle Spell',
        description: 'Cast without Somatic or Verbal components.',
        cost: { resource: 'sorcery-points', amount: 1 },
        effects: [{ target: 'spell.components.waive', value: ['verbal', 'somatic'] }]
      }
    ]);
    const d = derive(char([feat.slug], [FIREBALL.slug]), lookupFor([feat, FIREBALL]));
    expect(d.spellModifiers).toHaveLength(1);
    const mod = d.spellModifiers[0];
    expect(mod.id).toBe('subtle-spell');
    expect(mod.name).toBe('Subtle Spell');
    expect(mod.optional).toBe(true); // a cost implies optional
    expect(mod.cost).toEqual({ resource: 'sorcery-points', amount: 1 });
    expect(mod.effects).toEqual([
      { target: 'spell.components.waive', mode: 'ADD', value: ['v', 's'] }
    ]);
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });

  it('warns on an unrecognized parameter target without an unknown-* code', () => {
    const feat = featRow('test-bad-target', [
      {
        kind: 'spell-modifier',
        id: 'bad',
        effects: [{ target: 'spell.nonsense', value: true }]
      }
    ]);
    const d = derive(char([feat.slug], []), lookupFor([feat]));
    expect(d.validations.find((v) => v.code === 'spell-parameter-unrecognized')?.message).toContain(
      'spell.nonsense'
    );
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
    // The entry still rides the manifest for the planner.
    expect(d.spellModifiers).toHaveLength(1);
  });
});

describe('optional modifiers (Metamagic)', () => {
  it('list themselves on matching spell actions and change nothing', () => {
    const feat = featRow('test-quickened-spell', [
      {
        kind: 'spell-modifier',
        id: 'quickened-spell',
        name: 'Quickened Spell',
        cost: { resource: 'sorcery-points', amount: 2 },
        effects: [{ target: 'spell.castingTime', mode: 'OVERRIDE', value: 'bonus' }]
      }
    ]);
    const d = derive(char([feat.slug], [FIREBALL.slug]), lookupFor([feat, FIREBALL]));
    const action = spellAction(d, 'Test Fireball');
    expect(action.cost).toBe('action');
    expect(action.availableSpellModifiers).toEqual(['quickened-spell']);
  });

  it('honor the spell predicate when listing', () => {
    const feat = featRow('test-split-enchantment', [
      {
        kind: 'spell-modifier',
        id: 'split-enchantment',
        name: 'Split Enchantment',
        optional: true,
        appliesTo: { predicates: [{ 'spell.school': 'enchantment' }] },
        effects: [{ target: 'spell.targets', mode: 'ADD', value: 1 }]
      }
    ]);
    const d = derive(
      char([feat.slug], [FIREBALL.slug, MINOR_ILLUSION.slug]),
      lookupFor([feat, FIREBALL, MINOR_ILLUSION])
    );
    expect(spellAction(d, 'Test Fireball').availableSpellModifiers).toBeUndefined();
    expect(spellAction(d, 'Test Minor Illusion').availableSpellModifiers).toBeUndefined();
  });
});

describe('always-on modifiers fold into the Action', () => {
  it('bumps range and waives components on a school-scoped predicate', () => {
    // Improved Illusions: Verbal-component waiver + range +60 ft on
    // Illusion spells.
    const feat = featRow('test-improved-illusions', [
      {
        kind: 'spell-modifier',
        id: 'improved-illusions',
        name: 'Improved Illusions',
        appliesTo: { predicates: [{ 'spell.school': 'illusion' }] },
        effects: [
          { target: 'spell.components.waive', value: 'v' },
          { target: 'spell.range', mode: 'ADD', value: 60 }
        ]
      }
    ]);
    const d = derive(
      char([feat.slug], [FIREBALL.slug, MINOR_ILLUSION.slug]),
      lookupFor([feat, FIREBALL, MINOR_ILLUSION])
    );
    const illusion = spellAction(d, 'Test Minor Illusion');
    expect(illusion.range).toEqual({ value: 90, units: 'ft' });
    expect(illusion.componentsWaived).toEqual(['v']);
    const fireball = spellAction(d, 'Test Fireball');
    expect(fireball.range).toEqual({ value: 150, units: 'ft' });
    expect(fireball.componentsWaived).toBeUndefined();
  });

  it('substitutes the damage type on every part', () => {
    const feat = featRow('test-psychic-spells', [
      {
        kind: 'spell-modifier',
        id: 'psychic-spells',
        name: 'Psychic Spells',
        effects: [{ target: 'spell.damageType', mode: 'OVERRIDE', value: 'psychic' }]
      }
    ]);
    const d = derive(char([feat.slug], [FIREBALL.slug]), lookupFor([feat, FIREBALL]));
    expect(spellAction(d, 'Test Fireball').damageRolls).toEqual([
      { formula: '8d6', type: 'psychic' }
    ]);
  });

  it('turns Touch range into a fixed distance (Distant Spell)', () => {
    const feat = featRow('test-distant-spell-passive', [
      {
        kind: 'spell-modifier',
        id: 'distant-touch',
        optional: false,
        effects: [{ target: 'spell.range.touch-becomes', value: 30 }]
      }
    ]);
    const d = derive(char([feat.slug], [BEAST_SENSE.slug]), lookupFor([feat, BEAST_SENSE]));
    expect(spellAction(d, 'Test Beast Sense').range).toEqual({ value: 30, units: 'ft' });
  });

  it('doubles range with MULTIPLY and adds target count', () => {
    const feat = featRow('test-range-and-targets', [
      {
        kind: 'spell-modifier',
        id: 'wide-and-far',
        effects: [
          { target: 'spell.range', mode: 'MULTIPLY', value: 2 },
          { target: 'spell.targets', mode: 'ADD', value: 1 }
        ]
      }
    ]);
    const d = derive(char([feat.slug], [FIREBALL.slug]), lookupFor([feat, FIREBALL]));
    const action = spellAction(d, 'Test Fireball');
    expect(action.range).toEqual({ value: 300, units: 'ft' });
    expect(action.targetCount).toBe(2);
  });

  it('sets the ritual-only flag on named spells only', () => {
    const feat = featRow('test-spirit-seeker', [
      {
        kind: 'spell-modifier',
        id: 'spirit-seeker',
        name: 'Spirit Seeker',
        appliesTo: { predicates: [{ 'spell.slug': [BEAST_SENSE.slug] }] },
        effects: [{ target: 'spell.ritual-only', value: true }]
      }
    ]);
    const d = derive(
      char([feat.slug], [BEAST_SENSE.slug, FIREBALL.slug]),
      lookupFor([feat, BEAST_SENSE, FIREBALL])
    );
    expect(spellAction(d, 'Test Beast Sense').ritualOnly).toBe(true);
    expect(spellAction(d, 'Test Fireball').ritualOnly).toBeUndefined();
  });

  it('does not touch non-spell actions', () => {
    const feat = featRow('test-broad', [
      {
        kind: 'spell-modifier',
        id: 'broad',
        effects: [{ target: 'spell.damageType', mode: 'OVERRIDE', value: 'psychic' }]
      },
      {
        kind: 'stat-modifier',
        target: 'initiative',
        value: 0
      }
    ]);
    const weapon: ContentRow = {
      kind: 'item',
      slug: 'test-club',
      version: 1,
      name: 'Club',
      source: 'test',
      data: {
        category: 'weapon',
        weaponType: 'simple-melee',
        damage: '1d4',
        damageType: 'bludgeoning'
      }
    };
    const c = char([feat.slug], []);
    c.inventory = [
      { contentKind: 'item', contentSlug: weapon.slug, equipped: true, attuned: false }
    ];
    const d = derive(c, lookupFor([feat, weapon]));
    const attack = d.actions.find((a) => a.sourceContent.slug === weapon.slug)!;
    expect(attack.damageRolls?.[0].type).toBe('bludgeoning');
  });
});

describe('gating', () => {
  it('respects appliesWhen.condition like any other modifier', () => {
    const feat = featRow('test-gated-spell-mod', [
      {
        kind: 'spell-modifier',
        id: 'gated',
        appliesWhen: { condition: 'raging' },
        effects: [{ target: 'spell.damageType', mode: 'OVERRIDE', value: 'psychic' }]
      }
    ]);
    const c = char([feat.slug], [FIREBALL.slug]);
    const lookup = lookupFor([feat, FIREBALL]);
    expect(derive(c, lookup).spellModifiers).toEqual([]);
    expect(spellAction(derive(c, lookup), 'Test Fireball').damageRolls?.[0].type).toBe('fire');
    c.conditions = ['raging'];
    expect(derive(c, lookup).spellModifiers).toHaveLength(1);
    expect(spellAction(derive(c, lookup), 'Test Fireball').damageRolls?.[0].type).toBe('psychic');
  });
});
