// Item charge pools — `data.charges` on an equipped item emits a shared
// `item/<slug>/charges` resource; activities with `chargeCost` debit it
// via Action.spendsResource / resourceCost. Also locks the rest-cadence
// fix: per-'day' / 'dawn' resources reset on long rest (they previously
// never reset at all).

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { refreshSpentResourcesOnRest, restRefreshPeriods } from '../rest';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function withInventory(
  extra: CharacterDocument['inventory'],
  overrides: Partial<CharacterDocument> = {}
): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    inventory: [...chronurgy.CHARACTER.inventory, ...extra],
    ...overrides
  };
}

function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
  const base = chronurgy.makeLookup(packs);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

function chargedWand(data: Record<string, unknown>): ContentRow {
  return {
    kind: 'item',
    slug: 'test-charged-wand',
    version: 1,
    name: 'Test Charged Wand',
    source: 'test',
    data: {
      category: 'wondrous',
      rarity: 'rare',
      ...data
    }
  };
}

const EQUIPPED = [
  { contentKind: 'item', contentSlug: 'test-charged-wand', version: 1, equipped: true, attuned: true }
];

describe('item charge pools', () => {
  it('emits a stable item/<slug>/charges resource from the engine-native shape', () => {
    const wand = chargedWand({
      charges: { max: 7, recharge: { amount: '1d6+1', per: 'dawn' } }
    });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);

    const pool = d.resources.find((r) => r.id === 'item/test-charged-wand/charges');
    expect(pool).toBeDefined();
    expect(pool!.name).toBe('Test Charged Wand Charges');
    expect(pool!.max).toBe(7);
    expect(pool!.used).toBe(0);
    expect(pool!.per).toBe('dawn');
    expect(pool!.sourceContent).toEqual({ kind: 'item', slug: 'test-charged-wand' });
  });

  it('round-trips spend state through character.resourcesSpent (clamped to max)', () => {
    const wand = chargedWand({ charges: { max: 3, recharge: { per: 'dawn' } } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });

    const spent = derive(
      withInventory(EQUIPPED, { resourcesSpent: { 'item/test-charged-wand/charges': 2 } }),
      lookup
    );
    expect(spent.resources.find((r) => r.id === 'item/test-charged-wand/charges')!.used).toBe(2);

    const overspent = derive(
      withInventory(EQUIPPED, { resourcesSpent: { 'item/test-charged-wand/charges': 99 } }),
      lookup
    );
    expect(overspent.resources.find((r) => r.id === 'item/test-charged-wand/charges')!.used).toBe(3);
  });

  it('normalizes the legacy display shape {max, per: "day"} to a dawn recharge', () => {
    const wand = chargedWand({ charges: { max: 5, per: 'day' } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);

    const pool = d.resources.find((r) => r.id === 'item/test-charged-wand/charges');
    expect(pool).toBeDefined();
    expect(pool!.max).toBe(5);
    expect(pool!.per).toBe('dawn');
  });

  it('normalizes the 5etools flat shape (charges number + sibling recharge)', () => {
    const dawnWand = chargedWand({ charges: 6, recharge: 'dawn' });
    const noRecharge = chargedWand({ charges: 4 });

    const dDawn = derive(
      withInventory(EQUIPPED),
      wrapLookup(PACKS, { 'item/test-charged-wand': dawnWand })
    );
    expect(dDawn.resources.find((r) => r.id === 'item/test-charged-wand/charges')!.per).toBe('dawn');

    const dNever = derive(
      withInventory(EQUIPPED),
      wrapLookup(PACKS, { 'item/test-charged-wand': noRecharge })
    );
    expect(dNever.resources.find((r) => r.id === 'item/test-charged-wand/charges')!.per).toBe(
      'never'
    );
  });

  it('honors recharge: "never" on the engine-native shape', () => {
    const wand = chargedWand({ charges: { max: 3, recharge: 'never' } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);
    expect(d.resources.find((r) => r.id === 'item/test-charged-wand/charges')!.per).toBe('never');
  });

  it('attaches spendsResource + resourceCost to chargeCost activities', () => {
    const wand = chargedWand({
      charges: { max: 7, recharge: { per: 'dawn' } },
      activities: [
        {
          id: 'wand-blast-small',
          type: 'save',
          name: 'Small Blast',
          cost: 'action',
          chargeCost: 1,
          save: { ability: 'dex', dc: { value: 15 } }
        },
        {
          id: 'wand-blast-big',
          type: 'save',
          name: 'Big Blast',
          cost: 'action',
          chargeCost: 3,
          save: { ability: 'dex', dc: { value: 15 } }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);

    const small = d.actions.find((a) => a.id.endsWith('/wand-blast-small'));
    const big = d.actions.find((a) => a.id.endsWith('/wand-blast-big'));
    expect(small!.spendsResource).toBe('item/test-charged-wand/charges');
    expect(small!.resourceCost).toBe(1);
    expect(big!.spendsResource).toBe('item/test-charged-wand/charges');
    expect(big!.resourceCost).toBe(3);
  });

  it('does NOT attach the pool to activities with their own uses block', () => {
    const wand = chargedWand({
      charges: { max: 7, recharge: { per: 'dawn' } },
      activities: [
        {
          id: 'wand-daily',
          type: 'utility',
          name: 'Daily Trick',
          cost: 'action',
          uses: { max: 1, per: 'day' }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);

    const daily = d.actions.find((a) => a.id.endsWith('/wand-daily'));
    expect(daily!.spendsResource).toBeUndefined();
    expect(daily!.resourceCost).toBeUndefined();
    // The uses block still emits its independent per-activity resource.
    expect(d.resources.some((r) => r.id === 'item/test-charged-wand/wand-daily')).toBe(true);
    expect(d.resources.some((r) => r.id === 'item/test-charged-wand/charges')).toBe(true);
  });

  it('emits no pool when the item is unequipped', () => {
    const wand = chargedWand({ charges: { max: 7, recharge: { per: 'dawn' } } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(
      withInventory([
        { contentKind: 'item', contentSlug: 'test-charged-wand', version: 1, equipped: false, attuned: false }
      ]),
      lookup
    );
    expect(d.resources.some((r) => r.id === 'item/test-charged-wand/charges')).toBe(false);
  });
});

describe('rest cadence for day/dawn resources (regression)', () => {
  it("long rest resets per:'day' resources — Driftglobe's 1/day Daylight", () => {
    // Regression: per-'day' resources were never reset by any rest (the
    // sheet only cleared 'short-rest' and 'long-rest' cadences).
    const character = withInventory(
      [{ contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: true, attuned: false }],
      { resourcesSpent: { 'item/driftglobe/driftglobe-cast-daylight': 1 } }
    );
    const d = derive(character, chronurgy.makeLookup(PACKS));
    const dayRes = d.resources.find((r) => r.id === 'item/driftglobe/driftglobe-cast-daylight');
    expect(dayRes).toBeDefined();
    expect(dayRes!.per).toBe('day');
    expect(dayRes!.used).toBe(1);

    const afterLong = refreshSpentResourcesOnRest(
      character.resourcesSpent,
      d.resources,
      'long-rest'
    );
    expect(afterLong['item/driftglobe/driftglobe-cast-daylight']).toBe(0);

    const afterShort = refreshSpentResourcesOnRest(
      character.resourcesSpent,
      d.resources,
      'short-rest'
    );
    expect(afterShort['item/driftglobe/driftglobe-cast-daylight']).toBe(1);
  });

  it('long rest resets dawn charge pools; short rest does not; never is never reset', () => {
    const resources = [
      { id: 'item/wand-a/charges', per: 'dawn' },
      { id: 'item/wand-b/charges', per: 'never' },
      { id: 'item/wand-c/charges', per: 'short-rest' }
    ];
    const spent = {
      'item/wand-a/charges': 2,
      'item/wand-b/charges': 2,
      'item/wand-c/charges': 2
    };

    const afterShort = refreshSpentResourcesOnRest(spent, resources, 'short-rest');
    expect(afterShort['item/wand-a/charges']).toBe(2);
    expect(afterShort['item/wand-b/charges']).toBe(2);
    expect(afterShort['item/wand-c/charges']).toBe(0);

    const afterLong = refreshSpentResourcesOnRest(spent, resources, 'long-rest');
    expect(afterLong['item/wand-a/charges']).toBe(0);
    expect(afterLong['item/wand-b/charges']).toBe(2);
    expect(afterLong['item/wand-c/charges']).toBe(0);
  });

  it('restRefreshPeriods long-rest set covers short-rest / long-rest / day / dawn', () => {
    const long = restRefreshPeriods('long-rest');
    for (const per of ['short-rest', 'long-rest', 'day', 'dawn']) {
      expect(long.has(per)).toBe(true);
    }
    expect(long.has('never')).toBe(false);
    const short = restRefreshPeriods('short-rest');
    expect([...short]).toEqual(['short-rest']);
  });
});

describe("weekly recharge cadence (per: 'week')", () => {
  it('emits the pool with per week from the engine-native shape', () => {
    const wand = chargedWand({ charges: { max: 5, recharge: { per: 'week' } } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);
    const pool = d.resources.find((r) => r.id === 'item/test-charged-wand/charges');
    expect(pool).toBeDefined();
    expect(pool!.per).toBe('week');
  });

  it("normalizes the 5etools sibling shape recharge: '7 days' to week", () => {
    const wand = chargedWand({ charges: 1, recharge: '7 days' });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);
    const pool = d.resources.find((r) => r.id === 'item/test-charged-wand/charges');
    expect(pool!.per).toBe('week');
  });

  it('is NOT reset by short or long rests — manual restore only', () => {
    const wand = chargedWand({ charges: { max: 5, recharge: { per: 'week' } } });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(
      withInventory(EQUIPPED, { resourcesSpent: { 'item/test-charged-wand/charges': 3 } }),
      lookup
    );
    const spent = { 'item/test-charged-wand/charges': 3 };
    const afterShort = refreshSpentResourcesOnRest(spent, d.resources, 'short-rest');
    const afterLong = refreshSpentResourcesOnRest(spent, d.resources, 'long-rest');
    expect(afterShort['item/test-charged-wand/charges']).toBe(3);
    expect(afterLong['item/test-charged-wand/charges']).toBe(3);
    // The shared cadence sets exclude 'week' outright.
    expect(restRefreshPeriods('short-rest').has('week')).toBe(false);
    expect(restRefreshPeriods('long-rest').has('week')).toBe(false);
  });

  it("activity uses with per: 'week' emit a resource that no rest refreshes", () => {
    const wand = chargedWand({
      activities: [
        {
          id: 'weekly-call',
          name: 'Weekly Call',
          type: 'utility',
          cost: 'action',
          uses: { max: 1, per: 'week' }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-charged-wand': wand });
    const d = derive(withInventory(EQUIPPED), lookup);
    const res = d.resources.find((r) => r.id === 'item/test-charged-wand/weekly-call');
    expect(res).toBeDefined();
    expect(res!.per).toBe('week');
    const after = refreshSpentResourcesOnRest(
      { 'item/test-charged-wand/weekly-call': 1 },
      d.resources,
      'long-rest'
    );
    expect(after['item/test-charged-wand/weekly-call']).toBe(1);
  });
});
