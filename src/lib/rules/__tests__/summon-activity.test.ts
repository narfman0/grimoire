// Summon activity type — a `type: 'summon'` activity realizes into an
// Action carrying `summons` (creature slugs + evaluateValue-resolved
// counts + resolvedName from the monster row). Unresolved monster slugs
// fire the `summon-missing-content` soft warning (deliberately NOT an
// `unknown-*` code — the packs QC gate hard-fails T3 rows on those, and
// cross-pack / homebrew monster refs may not resolve in a partial
// lookup). Cost integration (chargeCost pools, uses blocks) and the
// batch-1 attunement gate compose with summon exactly like every other
// activity type.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { applyUpcast } from '../upcast';
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

function summonItem(data: Record<string, unknown>): ContentRow {
  return {
    kind: 'item',
    slug: 'test-summon-horn',
    version: 1,
    name: 'Test Summoning Horn',
    source: 'test',
    data: {
      category: 'wondrous',
      rarity: 'rare',
      ...data
    }
  };
}

const EQUIPPED = [
  { contentKind: 'item', contentSlug: 'test-summon-horn', version: 1, equipped: true, attuned: true }
];

describe('summon activity realization', () => {
  it('emits an Action with summons: resolved counts, choice flag, resolvedName', () => {
    const horn = summonItem({
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          cost: 'action',
          summon: {
            creatures: [
              { slug: 'goblin', count: 3 },
              { slug: 'orc', name: 'Warband Leader' }
            ],
            duration: { value: 1, units: 'hour' }
          }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    const action = d.actions.find((a) => a.id.endsWith('/blow-horn'));
    expect(action).toBeDefined();
    expect(action!.type).toBe('summon');
    expect(action!.summons).toBeDefined();
    expect(action!.summons!.choice).toBe(false);
    expect(action!.summons!.duration).toEqual({ value: 1, units: 'hour' });
    expect(action!.summons!.creatures).toEqual([
      { slug: 'goblin', count: 3, resolvedName: 'Goblin' },
      { slug: 'orc', count: 1, name: 'Warband Leader', resolvedName: 'Orc' }
    ]);
    // Summon activities carry no summon-missing-content warning when
    // every slug resolves, and no unknown-activity-type (it's known).
    expect(d.validations.some((v) => v.code === 'summon-missing-content')).toBe(false);
    expect(d.validations.some((v) => v.code === 'unknown-activity-type')).toBe(false);
  });

  it('evaluates magic-string counts via evaluateValue and defaults count to 1', () => {
    const horn = summonItem({
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          summon: {
            creatures: [{ slug: 'goblin', count: 'proficiencyBonus' }],
            choice: true
          }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    const action = d.actions.find((a) => a.id.endsWith('/blow-horn'));
    // Chronurgy fixture is a mid-level character; PB is derived, just
    // assert it resolved to a positive integer (not the literal string).
    const creature = action!.summons!.creatures[0];
    expect(typeof creature.count).toBe('number');
    expect(creature.count).toBeGreaterThanOrEqual(2);
    expect(action!.summons!.choice).toBe(true);
  });

  it('fires summon-missing-content (not unknown-*) for an unresolved monster slug', () => {
    const horn = summonItem({
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          summon: {
            creatures: [{ slug: 'monster-from-another-pack' }, { slug: 'goblin' }]
          }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    const warnings = d.validations.filter((v) => v.code === 'summon-missing-content');
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].message).toContain('monster-from-another-pack');
    // The QC gate greps `unknown-*` codes only — this must never match.
    expect(warnings[0].code.startsWith('unknown-')).toBe(false);

    // The action still realizes; the unresolved creature has no
    // resolvedName (runtime falls back to a DM-editable shell).
    const action = d.actions.find((a) => a.id.endsWith('/blow-horn'));
    expect(action!.summons!.creatures[0]).toEqual({
      slug: 'monster-from-another-pack',
      count: 1
    });
    expect(action!.summons!.creatures[1].resolvedName).toBe('Goblin');
  });

  it('composes with item charge pools via chargeCost (batch-1 semantics)', () => {
    const horn = summonItem({
      charges: { max: 5, recharge: { per: 'dawn' } },
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          chargeCost: 2,
          summon: { creatures: [{ slug: 'goblin', count: 2 }] }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    const action = d.actions.find((a) => a.id.endsWith('/blow-horn'));
    expect(action!.summons).toBeDefined();
    expect(action!.spendsResource).toBe('item/test-summon-horn/charges');
    expect(action!.resourceCost).toBe(2);
    expect(d.resources.some((r) => r.id === 'item/test-summon-horn/charges')).toBe(true);
  });

  it('composes with per-activity uses blocks (independent resource, no pool)', () => {
    const horn = summonItem({
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          uses: { max: 1, per: 'day' },
          summon: { creatures: [{ slug: 'goblin' }] }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    const action = d.actions.find((a) => a.id.endsWith('/blow-horn'));
    expect(action!.summons).toBeDefined();
    expect(action!.spendsResource).toBeUndefined();
    const res = d.resources.find((r) => r.id === 'item/test-summon-horn/blow-horn');
    expect(res).toBeDefined();
    expect(res!.max).toBe(1);
    expect(res!.per).toBe('day');
  });

  it('is gated by attunement: no summon action from an unattuned attunement item', () => {
    const horn = summonItem({
      requiresAttunement: true,
      activities: [
        {
          id: 'blow-horn',
          name: 'Blow the Horn',
          type: 'summon',
          summon: { creatures: [{ slug: 'goblin' }] }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const unattuned = withInventory([
      { contentKind: 'item', contentSlug: 'test-summon-horn', version: 1, equipped: true, attuned: false }
    ]);
    const d = derive(unattuned, lookup);
    expect(d.actions.some((a) => a.id.endsWith('/blow-horn'))).toBe(false);

    // Attuned, the same item surfaces the action.
    const attuned = derive(withInventory(EQUIPPED), lookup);
    expect(attuned.actions.some((a) => a.id.endsWith('/blow-horn'))).toBe(true);
  });

  it('emits no summons payload when the summon block is empty or malformed', () => {
    const horn = summonItem({
      activities: [
        { id: 'no-block', name: 'No Block', type: 'summon' },
        { id: 'empty-list', name: 'Empty List', type: 'summon', summon: { creatures: [] } },
        {
          id: 'bad-slugs',
          name: 'Bad Slugs',
          type: 'summon',
          summon: { creatures: [{ count: 2 }, { slug: '' }] }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': horn });
    const d = derive(withInventory(EQUIPPED), lookup);

    for (const id of ['no-block', 'empty-list', 'bad-slugs']) {
      const action = d.actions.find((a) => a.id.endsWith(`/${id}`));
      expect(action).toBeDefined();
      expect(action!.summons).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Open CR budgets — the 2014 conjure family names a budget, not a list.
// ---------------------------------------------------------------------------

describe('summon budgets (open CR)', () => {
  function budgetItem(budget: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return summonItem({
      activities: [
        {
          id: 'conjure',
          name: 'Conjure',
          type: 'summon',
          cost: 'action',
          summon: { budget },
          ...extra
        }
      ]
    });
  }

  function actionFor(item: ContentRow) {
    const lookup = wrapLookup(PACKS, { 'item/test-summon-horn': item });
    const d = derive(withInventory(EQUIPPED), lookup);
    return { d, action: d.actions.find((a) => a.id.endsWith('/conjure'))! };
  }

  it('carries a multi-line budget with fractional CRs and creature types', () => {
    const { d, action } = actionFor(
      budgetItem({
        creatureTypes: ['beast'],
        options: [
          { crMax: 2, count: 1 },
          { crMax: 1, count: 2 },
          { crMax: '1/2', count: 4 },
          { crMax: '1/4', count: 8 }
        ]
      })
    );
    expect(action.summons!.budget).toEqual({
      creatureTypes: ['beast'],
      options: [
        { crMax: 2, count: 1 },
        { crMax: 1, count: 2 },
        { crMax: 0.5, count: 4 },
        { crMax: 0.25, count: 8 }
      ]
    });
    // A budget-only summon has no explicit creature list and defaults to
    // a pick-one-at-cast-time shape.
    expect(action.summons!.creatures).toEqual([]);
    expect(action.summons!.choice).toBe(true);
    // Never a warning — the budget names no slug to resolve.
    expect(d.validations.some((v) => v.code === 'summon-missing-content')).toBe(false);
    expect(d.validations.some((v) => v.code.startsWith('unknown-'))).toBe(false);
  });

  it('normalizes a flat single-line budget into a one-entry options array', () => {
    const { action } = actionFor(
      budgetItem({ crMax: 4, creatureType: 'celestial', dmChoice: true, note: 'DM picks' })
    );
    expect(action.summons!.budget).toEqual({
      options: [{ crMax: 4 }],
      creatureTypes: ['celestial'],
      dmChoice: true,
      note: 'DM picks'
    });
  });

  it('accepts a type-only budget with no CR line (planar ally shape)', () => {
    const { action } = actionFor(
      budgetItem({ creatureTypes: ['celestial', 'elemental', 'fiend'], dmChoice: true })
    );
    expect(action.summons!.budget!.options).toEqual([]);
    expect(action.summons!.budget!.creatureTypes).toEqual(['celestial', 'elemental', 'fiend']);
  });

  it('resolves evaluateValue tokens in budget numbers', () => {
    const { action } = actionFor(budgetItem({ crMax: 'proficiencyBonus', count: 2 }));
    expect(typeof action.summons!.budget!.options[0].crMax).toBe('number');
    expect(action.summons!.budget!.options[0].crMax).toBeGreaterThanOrEqual(2);
  });

  it('keeps sizeMax / totalCr and drops malformed lines', () => {
    const { action } = actionFor(
      budgetItem({
        options: [{ crMax: 1, sizeMax: 'large', totalCr: 6 }, { sizeMax: 'colossal' }, {}]
      })
    );
    expect(action.summons!.budget!.options).toEqual([
      { crMax: 1, totalCr: 6, sizeMax: 'large' }
    ]);
  });

  it('emits no budget for a malformed / empty block', () => {
    for (const raw of [{}, { options: [] }, { creatureTypes: [] }]) {
      const { action } = actionFor(budgetItem(raw));
      expect(action.summons).toBeUndefined();
    }
  });

  it('composes with a summon list: both the shortlist and the budget ride', () => {
    const horn = summonItem({
      activities: [
        {
          id: 'conjure',
          name: 'Conjure',
          type: 'summon',
          summon: {
            creatures: [{ slug: 'goblin', count: 2 }],
            budget: { creatureTypes: ['fey'], crMax: 6 }
          }
        }
      ]
    });
    const { action } = actionFor(horn);
    expect(action.summons!.creatures[0].slug).toBe('goblin');
    expect(action.summons!.budget!.options).toEqual([{ crMax: 6 }]);
  });

  it('applyUpcast swaps in the highest bySlotLevel entry <= the cast slot', () => {
    const { action } = actionFor(
      budgetItem(
        {
          creatureTypes: ['beast'],
          options: [{ crMax: 2, count: 1 }],
          bySlotLevel: {
            5: [{ crMax: 2, count: 2 }],
            7: [{ crMax: 2, count: 3 }],
            9: [{ crMax: 2, count: 4 }]
          }
        },
        { upcastScaling: { baseSlotLevel: 3 } }
      )
    );
    expect(applyUpcast(action, 3).summons!.budget!.options).toEqual([{ crMax: 2, count: 1 }]);
    expect(applyUpcast(action, 5).summons!.budget!.options).toEqual([{ crMax: 2, count: 2 }]);
    expect(applyUpcast(action, 6).summons!.budget!.options).toEqual([{ crMax: 2, count: 2 }]);
    expect(applyUpcast(action, 9).summons!.budget!.options).toEqual([{ crMax: 2, count: 4 }]);
    // The table is stripped, so re-applying is a no-op.
    const cast = applyUpcast(action, 9);
    expect(cast.summons!.budget!.bySlotLevel).toBeUndefined();
    expect(applyUpcast(cast, 3).summons!.budget!.options).toEqual([{ crMax: 2, count: 4 }]);
    // The base action is untouched (applyUpcast stays pure).
    expect(action.summons!.budget!.bySlotLevel).toBeDefined();
  });

  it('applyUpcast resolves a slot-keyed budget with no upcastScaling on the action', () => {
    const { action } = actionFor(
      budgetItem({
        creatureTypes: ['celestial'],
        options: [{ crMax: 4 }],
        bySlotLevel: { 9: [{ crMax: 5 }] }
      })
    );
    expect(action.upcastScaling).toBeUndefined();
    expect(applyUpcast(action, 9).summons!.budget!.options).toEqual([{ crMax: 5 }]);
  });
});
