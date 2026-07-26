// Canonical on-hit rider trigger grants — structured display contracts
// for magic-weapon riders (extra damage on hit, condition on hit, HP-max
// reduction). Runtime stays DM-adjudicated: derive() passes the typed
// grant through Derived.triggers[].grants untouched. Also locks the
// attunement gate for item-sourced triggers (batch-1 wiring): an
// unattuned requiresAttunement item registers no triggers.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { CharacterDocument, ContentRow, TriggerGrant } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function withInventory(extra: CharacterDocument['inventory']): CharacterDocument {
  return {
    ...zealot.CHARACTER,
    inventory: [...zealot.CHARACTER.inventory, ...extra]
  };
}

function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
  const base = zealot.makeLookup(packs);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

/** A wounding-flame blade carrying all three canonical rider shapes. */
const RIDER_BLADE: ContentRow = {
  kind: 'item',
  slug: 'test-rider-blade',
  version: 1,
  name: 'Test Rider Blade',
  source: 'test',
  data: {
    category: 'weapon',
    weaponType: 'martial-melee',
    damage: '1d8',
    damageType: 'slashing',
    requiresAttunement: true,
    triggers: [
      {
        id: 'rider-blade-fire',
        name: 'Flame Rider',
        on: ['attack.hit'],
        grants: { type: 'damage.rider', amount: '2d6', damageType: 'fire' }
      },
      {
        id: 'rider-blade-venom',
        name: 'Venom Rider',
        on: ['attack.hit'],
        grants: {
          type: 'condition.rider',
          condition: 'poisoned',
          save: { ability: 'con', dc: 15 },
          duration: { value: 1, units: 'minute' }
        }
      },
      {
        id: 'rider-blade-wounding',
        name: 'Life Stealing',
        on: ['attack.crit'],
        grants: { type: 'hp.max-reduce', amount: '3d6' }
      }
    ]
  }
};

const slot = (attuned: boolean) => ({
  contentKind: 'item',
  contentSlug: 'test-rider-blade',
  version: 1,
  equipped: true,
  attuned
});

describe('canonical on-hit rider trigger grants', () => {
  it('passes the structured grant shapes through Derived.triggers[].grants', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-rider-blade': RIDER_BLADE });
    const d = derive(withInventory([slot(true)]), lookup);

    const fire = d.triggers.find((t) => t.id === 'rider-blade-fire');
    const venom = d.triggers.find((t) => t.id === 'rider-blade-venom');
    const wounding = d.triggers.find((t) => t.id === 'rider-blade-wounding');

    // Typed narrowing exercises the new union arms end to end.
    const fireGrant: TriggerGrant | undefined = fire?.grants;
    expect(fireGrant).toEqual({ type: 'damage.rider', amount: '2d6', damageType: 'fire' });
    if (fireGrant?.type === 'damage.rider') {
      expect(fireGrant.amount).toBe('2d6');
      expect(fireGrant.damageType).toBe('fire');
    }

    expect(venom?.grants).toEqual({
      type: 'condition.rider',
      condition: 'poisoned',
      save: { ability: 'con', dc: 15 },
      duration: { value: 1, units: 'minute' }
    });
    expect(wounding?.grants).toEqual({ type: 'hp.max-reduce', amount: '3d6' });
    expect(wounding?.sourceContent).toEqual({ kind: 'item', slug: 'test-rider-blade' });

    // No unknown-trigger-event warnings — canonical events only.
    expect(d.validations.some((v) => v.code === 'unknown-trigger-event')).toBe(false);
  });

  it('item triggers respect the requiresAttunement wholesale gate', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-rider-blade': RIDER_BLADE });

    const unattuned = derive(withInventory([slot(false)]), lookup);
    expect(unattuned.triggers.some((t) => t.id.startsWith('rider-blade'))).toBe(false);
    // The mundane weapon swing still synthesizes (unattuned fallback).
    expect(
      unattuned.actions.some((a) => a.id === 'item/test-rider-blade/test-rider-blade-attack')
    ).toBe(true);

    const attuned = derive(withInventory([slot(true)]), lookup);
    expect(attuned.triggers.filter((t) => t.id.startsWith('rider-blade'))).toHaveLength(3);
  });

  it("per-entry requires: 'equipped:attuned' gates a trigger on a non-attunement item", () => {
    const gated: ContentRow = {
      ...RIDER_BLADE,
      slug: 'test-gated-blade',
      name: 'Test Gated Blade',
      data: {
        ...RIDER_BLADE.data,
        requiresAttunement: false,
        triggers: [
          {
            id: 'gated-blade-fire',
            name: 'Flame Rider',
            on: ['attack.hit'],
            appliesWhen: { requires: 'equipped:attuned' },
            grants: { type: 'damage.rider', amount: '1d6', damageType: 'fire' }
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-gated-blade': gated });
    const mk = (attuned: boolean) =>
      derive(
        withInventory([{ contentKind: 'item', contentSlug: 'test-gated-blade', version: 1, equipped: true, attuned }]),
        lookup
      );
    expect(mk(false).triggers.some((t) => t.id === 'gated-blade-fire')).toBe(false);
    expect(mk(true).triggers.some((t) => t.id === 'gated-blade-fire')).toBe(true);
  });
});
