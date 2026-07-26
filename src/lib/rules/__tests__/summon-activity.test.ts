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
