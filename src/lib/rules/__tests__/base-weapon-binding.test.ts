// Base-weapon binding — `data.baseWeaponFromChoice: true` items (an
// "enspelled longsword" IS the longsword). The picked base weapon row
// supplies damage / damageType / weaponType / properties; the item's
// own stat-modifiers (attack.bonus / damage.bonus reroute, activations)
// apply to the synthesized attack because the action's sourceContent
// slug is the item's — the reroute's per-item `weapon.slug` predicate
// matches. Without a pick the item contributes no attack action.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { CharacterDocument, ContentRow, InventorySlot } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

// Barbarian L3, STR 15 + Half-Orc +2 → 17 (+3), PB +2 — martial-
// proficient. Rage dropped so the rage-damage action-modifier doesn't
// fold into damage asserts, and the greatsword unequipped so the bound
// item is the only weapon.
function character(extra: InventorySlot[]): CharacterDocument {
  return {
    ...zealot.CHARACTER,
    conditions: [],
    inventory: [
      ...zealot.CHARACTER.inventory.map((s) => ({ ...s, equipped: false })),
      ...extra
    ]
  };
}

function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
  const base = zealot.makeLookup(packs);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

/** A +1 "any sword" — no damage of its own; the base supplies the swing. */
const ANY_SWORD: ContentRow = {
  kind: 'item',
  slug: 'test-enspelled-sword',
  version: 1,
  name: 'Test Enspelled Sword',
  source: 'test',
  data: {
    category: 'weapon',
    rarity: 'rare',
    baseWeaponFromChoice: true,
    choices: {
      baseWeapon: { label: 'Base sword', allowedCategories: ['sword'] }
    },
    modifiers: [
      { kind: 'stat-modifier', target: 'attack.bonus', mode: 'ADD', value: 1 },
      { kind: 'stat-modifier', target: 'damage.bonus', mode: 'ADD', value: 1 }
    ]
  }
};

function slotFor(slug: string, choices?: Record<string, unknown>): InventorySlot {
  return {
    contentKind: 'item',
    contentSlug: slug,
    version: 1,
    equipped: true,
    attuned: false,
    ...(choices ? { choices } : {})
  };
}

describe('base-weapon binding', () => {
  it('synthesizes the attack from the picked base and applies the item bonus', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-enspelled-sword': ANY_SWORD });
    const d = derive(
      character([slotFor('test-enspelled-sword', { baseWeapon: 'longsword' })]),
      lookup
    );

    const attack = d.actions.find(
      (a) => a.id === 'item/test-enspelled-sword/test-enspelled-sword-attack'
    );
    expect(attack).toBeDefined();
    expect(attack!.name).toBe('Test Enspelled Sword Attack');
    expect(attack!.sourceContent).toEqual({ kind: 'item', slug: 'test-enspelled-sword' });
    // Longsword base: STR (+3) + proficiency (+2, martial via barbarian)
    // + the item's rerouted +1 attack bonus.
    expect(attack!.attackBonus).toBe(6);
    // 1d8 slashing + STR mod, + the item's rerouted +1 damage bonus.
    expect(attack!.damageRolls).toEqual([{ formula: '1d8+4', type: 'slashing' }]);
    // Properties flow from the base weapon.
    expect(attack!.weaponProperties).toContain('versatile');
    // The reroute predicate matched — the item bonus shows in appliedModifiers.
    expect(attack!.appliedModifiers.some((m) => m.modifierId.includes('item-action-bonus'))).toBe(
      true
    );
  });

  it('phase-4 predicates see the base weaponType (weapon.kind = martial-melee)', () => {
    const withKindMod: ContentRow = {
      ...ANY_SWORD,
      data: {
        ...ANY_SWORD.data,
        modifiers: [
          ...(ANY_SWORD.data.modifiers as Array<Record<string, unknown>>),
          {
            kind: 'action-modifier',
            name: 'Martial Hone',
            appliesTo: {
              activityType: 'attack',
              predicates: [{ 'weapon.slug': 'test-enspelled-sword', 'weapon.kind': 'martial-melee' }]
            },
            effects: [{ target: 'attack.roll', mode: 'ADD', value: 2 }]
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-enspelled-sword': withKindMod });
    const d = derive(
      character([slotFor('test-enspelled-sword', { baseWeapon: 'longsword' })]),
      lookup
    );
    const attack = d.actions.find(
      (a) => a.id === 'item/test-enspelled-sword/test-enspelled-sword-attack'
    );
    // 3 (STR) + 2 (prof) + 1 (item bonus) + 2 (weapon.kind-gated modifier).
    expect(attack!.attackBonus).toBe(8);
  });

  it('without a pick the item contributes no attack and the gap is surfaced', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-enspelled-sword': ANY_SWORD });
    const d = derive(character([slotFor('test-enspelled-sword')]), lookup);

    expect(
      d.actions.some((a) => a.sourceContent.slug === 'test-enspelled-sword')
    ).toBe(false);
    const pending = d.pendingItemChoices.find(
      (p) => p.itemSlug === 'test-enspelled-sword' && p.choice === 'baseWeapon'
    );
    expect(pending).toBeDefined();
    expect(pending!.picked).toBeUndefined();
  });

  it('an explicit activities[] on the item wins over synthesis (no double actions)', () => {
    const explicit: ContentRow = {
      ...ANY_SWORD,
      data: {
        ...ANY_SWORD.data,
        activities: [
          {
            id: 'custom-strike',
            type: 'attack',
            name: 'Custom Strike',
            cost: 'action',
            attack: {
              ability: 'str',
              classification: 'weapon',
              range: 'melee',
              damage: [{ dice: '2d4', type: 'fire' }]
            }
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-enspelled-sword': explicit });
    const d = derive(
      character([slotFor('test-enspelled-sword', { baseWeapon: 'longsword' })]),
      lookup
    );
    const own = d.actions.filter((a) => a.sourceContent.slug === 'test-enspelled-sword');
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe('item/test-enspelled-sword/custom-strike');
  });

  it('falls back to flat-damage synthesis when the base row has no activities', () => {
    const flatBase: ContentRow = {
      kind: 'item',
      slug: 'test-homebrew-saber',
      version: 1,
      name: 'Homebrew Saber',
      source: 'test',
      data: {
        category: 'weapon',
        weaponType: 'martial-melee',
        properties: ['finesse'],
        damage: '1d6',
        damageType: 'slashing'
      }
    };
    const lookup = wrapLookup(PACKS, {
      'item/test-enspelled-sword': ANY_SWORD,
      'item/test-homebrew-saber': flatBase
    });
    const d = derive(
      character([slotFor('test-enspelled-sword', { baseWeapon: 'test-homebrew-saber' })]),
      lookup
    );
    const attack = d.actions.find(
      (a) => a.id === 'item/test-enspelled-sword/test-enspelled-sword-attack'
    );
    expect(attack).toBeDefined();
    // Finesse from the base: STR +3 vs DEX +1 → STR wins for this character.
    expect(attack!.attackAbility).toBe('str');
    expect(attack!.damageRolls).toEqual([{ formula: '1d6+4', type: 'slashing' }]);
  });
});
