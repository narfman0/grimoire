// Class-resource spend channel: an activity's / trigger's / activation's
// own `spendsResource` (+ `resourceCost`) now reaches the derived
// declaration, the pack-side `spendsKi` / `spendsSorceryPoints` aliases
// resolve to the pools the class rows declare, and `alternativeCosts`
// carries the "expend a spell slot instead" paths.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

function char(featSlugs: string[]): CharacterDocument {
  return {
    id: 'spend-channel-test',
    name: 'Spender',
    classes: [{ slug: 'monk', level: 6, hpRolledPerLevel: [8, 5, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 12, dex: 16, con: 14, int: 10, wis: 16, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 33,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featRow(slug: string, data: Record<string, unknown>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

describe('activity-level spendsResource', () => {
  it('reaches the Action with its cost amount', () => {
    const feat = featRow('test-touch-of-the-long-death', {
      activities: [
        {
          id: 'touch',
          name: 'Touch of the Long Death',
          type: 'save',
          cost: 'action',
          spendsResource: 'focus',
          resourceCost: 3,
          save: { ability: 'con', dc: { value: 15 } }
        }
      ]
    });
    const action = derive(char([feat.slug]), lookupFor([feat])).actions.find(
      (a) => a.name === 'Touch of the Long Death'
    )!;
    expect(action.spendsResource).toBe('focus');
    expect(action.resourceCost).toBe(3);
  });

  it('defaults the cost to 1', () => {
    const feat = featRow('test-tales-from-beyond', {
      activities: [
        {
          id: 'roll-a-tale',
          name: 'Tales from Beyond',
          type: 'utility',
          cost: 'bonus',
          spendsResource: 'bardic-inspiration'
        }
      ]
    });
    const action = derive(char([feat.slug]), lookupFor([feat])).actions.find(
      (a) => a.name === 'Tales from Beyond'
    )!;
    expect(action.spendsResource).toBe('bardic-inspiration');
    expect(action.resourceCost).toBe(1);
  });

  it('resolves the pack-side spendsKi alias onto the focus pool', () => {
    const feat = featRow('test-breath-of-the-dragon', {
      activities: [
        { id: 'breath', name: 'Breath of the Dragon', type: 'utility', cost: 'free', spendsKi: 2 }
      ]
    });
    const action = derive(char([feat.slug]), lookupFor([feat])).actions.find(
      (a) => a.name === 'Breath of the Dragon'
    )!;
    expect(action.spendsResource).toBe('focus');
    expect(action.resourceCost).toBe(2);
  });

  it('leaves an item charge pool in charge of spendsResource', () => {
    const item: ContentRow = {
      kind: 'item',
      slug: 'test-charged-wand',
      version: 1,
      name: 'Charged Wand',
      source: 'test',
      data: {
        category: 'wondrous',
        charges: { max: 7, recharge: { per: 'dawn' } },
        activities: [
          {
            id: 'zap',
            name: 'Zap',
            type: 'utility',
            cost: 'action',
            chargeCost: 2,
            spendsResource: 'focus'
          }
        ]
      }
    };
    const c = char([]);
    c.inventory = [
      { contentKind: 'item', contentSlug: item.slug, equipped: true, attuned: false }
    ];
    const action = derive(c, lookupFor([item])).actions.find((a) => a.name === 'Zap')!;
    expect(action.spendsResource).toBe('item/test-charged-wand/charges');
    expect(action.resourceCost).toBe(2);
  });
});

describe('trigger-level spendsResource', () => {
  it('reaches the TriggerDeclaration with a multi-point cost', () => {
    const feat = featRow('test-drunkards-luck', {
      triggers: [
        {
          kind: 'trigger',
          id: 'drunkards-luck',
          name: "Drunkard's Luck",
          on: ['attack.declare'],
          spendsResource: 'focus',
          resourceCost: 2,
          description: 'Cancel disadvantage on the roll.'
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const t = d.triggers.find((x) => x.name === "Drunkard's Luck")!;
    expect(t.spendsResource).toBe('focus');
    expect(t.resourceCost).toBe(2);
    expect(t.description).toBe('Cancel disadvantage on the roll.');
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });

  it('resolves the spendsBardicInspiration alias (Blade Flourish family)', () => {
    const feat = featRow('test-defensive-flourish', {
      triggers: [
        {
          kind: 'trigger',
          id: 'defensive-flourish',
          name: 'Defensive Flourish',
          on: ['attack.hit'],
          spendsBardicInspiration: 1
        }
      ]
    });
    const t = derive(char([feat.slug]), lookupFor([feat])).triggers.find(
      (x) => x.name === 'Defensive Flourish'
    )!;
    expect(t.spendsResource).toBe('bardic-inspiration');
    expect(t.resourceCost).toBe(1);
  });
});

describe('activation-level spendsResource + alternativeCosts', () => {
  it('mirrors the spend and the alternative path onto the manifest', () => {
    const feat = featRow('test-aspect-of-the-wyrm', {
      activations: [
        {
          id: 'aspect-of-the-wyrm',
          name: 'Aspect of the Wyrm',
          condition: 'aspect-of-the-wyrm',
          cost: 'bonus',
          uses: { max: 1, per: 'long-rest' },
          spendsResource: 'focus',
          resourceCost: 0,
          alternativeCosts: [{ kind: 'class-resource', resource: 'focus', amount: 3 }]
        }
      ]
    });
    const a = derive(char([feat.slug]), lookupFor([feat])).availableActivations.find(
      (x) => x.id === 'aspect-of-the-wyrm'
    )!;
    expect(a.spendsResource).toBe('focus');
    expect(a.resourceCost).toBe(1); // resourceCost 0 is not a spend; floors at 1
    expect(a.alternativeCosts).toEqual([
      { kind: 'class-resource', resource: 'focus', amount: 3 }
    ]);
  });

  it('has no spend fields when nothing is declared', () => {
    const feat = featRow('test-plain-activation', {
      activations: [{ id: 'plain', name: 'Plain', condition: 'plain' }]
    });
    const a = derive(char([feat.slug]), lookupFor([feat])).availableActivations.find(
      (x) => x.id === 'plain'
    )!;
    expect(a.spendsResource).toBeUndefined();
    expect(a.alternativeCosts).toBeUndefined();
  });
});

describe('alternativeCosts on activities', () => {
  it('carries a spell-slot alternative with its minimum level', () => {
    const feat = featRow('test-drakes-breath', {
      activities: [
        {
          id: 'drakes-breath',
          name: "Drake's Breath",
          type: 'save',
          cost: 'action',
          uses: { max: 1, per: 'long-rest' },
          alternativeCosts: [{ kind: 'spell-slot', minLevel: 3 }],
          save: { ability: 'dex', dc: { calc: 'spell' } }
        }
      ]
    });
    const action = derive(char([feat.slug]), lookupFor([feat])).actions.find(
      (a) => a.name === "Drake's Breath"
    )!;
    expect(action.alternativeCosts).toEqual([{ kind: 'spell-slot', minLevel: 3 }]);
  });

  it('accepts the singular key, defaults minLevel, and drops junk entries', () => {
    const feat = featRow('test-drake-companion', {
      activities: [
        {
          id: 'summon-drake',
          name: 'Drake Companion',
          type: 'utility',
          cost: 'action',
          alternativeCost: { kind: 'spell-slot' }
        },
        {
          id: 'junk',
          name: 'Junk',
          type: 'utility',
          alternativeCosts: [{ kind: 'nonsense' }, 7, null]
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    expect(d.actions.find((a) => a.name === 'Drake Companion')!.alternativeCosts).toEqual([
      { kind: 'spell-slot' }
    ]);
    expect(d.actions.find((a) => a.name === 'Junk')!.alternativeCosts).toBeUndefined();
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });
});
