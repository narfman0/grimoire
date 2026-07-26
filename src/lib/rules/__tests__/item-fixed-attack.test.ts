// Fixed attack bonuses + cast-spell overrides on item activities.
//
// A literal `attack.bonus` on an activity is used verbatim — no ability
// mod, no proficiency, no ability mod folded into the damage formula
// (Ring of the Ram: +7 to hit, 2d10 force flat). `spellOverrides` on a
// cast-spell activity replaces the character-derived save DC / attack
// bonus after the referenced spell's activity is inlined ("this item
// casts Fireball, save DC 15").

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function withInventory(extra: CharacterDocument['inventory']): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    inventory: [...chronurgy.CHARACTER.inventory, ...extra]
  };
}

function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
  const base = chronurgy.makeLookup(packs);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

function item(slug: string, name: string, data: Record<string, unknown>): ContentRow {
  return { kind: 'item', slug, version: 1, name, source: 'test', data };
}

const equippedSlot = (slug: string) => [
  { contentKind: 'item', contentSlug: slug, version: 1, equipped: true, attuned: true }
];

describe('fixed attack bonus (attack.bonus literal)', () => {
  it('uses the literal bonus verbatim with flat damage and no attackAbility', () => {
    const ring = item('test-ring-of-the-ram', 'Test Ring of the Ram', {
      category: 'wondrous',
      requiresAttunement: true,
      charges: { max: 3, recharge: { amount: '1d3', per: 'dawn' } },
      activities: [
        {
          id: 'ram-blast',
          type: 'attack',
          name: 'Ram Blast',
          cost: 'action',
          chargeCost: 1,
          attack: {
            bonus: 7,
            classification: 'spell',
            range: 'ranged',
            damage: [{ dice: '2d10', type: 'force' }]
          }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-ring-of-the-ram': ring });
    const d = derive(withInventory(equippedSlot('test-ring-of-the-ram')), lookup);

    const blast = d.actions.find((a) => a.id.endsWith('/ram-blast'));
    expect(blast).toBeDefined();
    // Verbatim: not abilityMod + PB — exactly 7.
    expect(blast!.attackBonus).toBe(7);
    // Damage stays flat: no ability mod appended.
    expect(blast!.damageRolls).toEqual([{ formula: '2d10', type: 'force' }]);
    // No ability behind the roll — attackAbility is unset.
    expect(blast!.attackAbility).toBeUndefined();
    expect(blast!.attackRange).toBe('ranged');
    // Charge debit still attaches alongside the fixed bonus.
    expect(blast!.spendsResource).toBe('item/test-ring-of-the-ram/charges');
    expect(blast!.resourceCost).toBe(1);
  });

  it('leaves the derived path untouched when attack.bonus is absent', () => {
    const sword = item('test-plain-sword', 'Test Plain Sword', {
      category: 'weapon',
      weaponType: 'martial-melee',
      properties: [],
      activities: [
        {
          id: 'plain-attack',
          type: 'attack',
          name: 'Plain Attack',
          cost: 'action',
          attack: {
            ability: 'str',
            classification: 'weapon',
            range: 'melee',
            damage: [{ dice: '1d8', type: 'slashing' }]
          }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-plain-sword': sword });
    const d = derive(withInventory(equippedSlot('test-plain-sword')), lookup);
    const base = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));

    const attack = d.actions.find((a) => a.id.endsWith('/plain-attack'))!;
    const strMod = base.stats.abilities.str.mod;
    // Ability path still composes (a martial weapon on a wizard is
    // non-proficient, so the bonus is the bare STR mod — matching the
    // pre-change behavior byte for byte).
    expect(attack.attackAbility).toBe('str');
    expect(attack.attackBonus).toBe(strMod);
  });
});

describe('cast-spell spellOverrides', () => {
  it('replaces the character-derived save DC after inlining the spell', () => {
    const necklace = item('test-necklace-of-fireballs', 'Test Necklace of Fireballs', {
      category: 'wondrous',
      activities: [
        {
          id: 'bead-of-fireball',
          type: 'cast-spell',
          name: 'Throw Bead (Fireball)',
          cost: 'action',
          spell: { slug: 'fireball' },
          spellOverrides: { saveDC: 15 }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-necklace-of-fireballs': necklace });
    const d = derive(withInventory(equippedSlot('test-necklace-of-fireballs')), lookup);

    const bead = d.actions.find((a) => a.id.endsWith('/bead-of-fireball'));
    expect(bead).toBeDefined();
    expect(bead!.saveDC).toEqual({ ability: 'dex', value: 15 });
    // Damage still inlined from the spell row.
    expect(bead!.damageRolls?.[0]?.formula).toBe('8d6');
  });

  it('without overrides the inlined DC stays character-derived', () => {
    const necklace = item('test-necklace-derived', 'Test Necklace (Derived DC)', {
      category: 'wondrous',
      activities: [
        {
          id: 'bead-derived',
          type: 'cast-spell',
          name: 'Throw Bead',
          cost: 'action',
          spell: { slug: 'fireball' }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-necklace-derived': necklace });
    const d = derive(withInventory(equippedSlot('test-necklace-derived')), lookup);
    const base = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));

    const bead = d.actions.find((a) => a.id.endsWith('/bead-derived'))!;
    expect(bead.saveDC?.value).toBe(base.stats.spellSaveDC);
  });

  it('replaces the character-derived attack bonus on inlined attack spells', () => {
    const wand = item('test-wand-of-frost', 'Test Wand of Frost', {
      category: 'wondrous',
      activities: [
        {
          id: 'wand-bolt',
          type: 'cast-spell',
          name: 'Fire Bolt (Wand)',
          cost: 'action',
          spell: { slug: 'fire-bolt' },
          spellOverrides: { attackBonus: 5 }
        }
      ]
    });
    const lookup = wrapLookup(PACKS, { 'item/test-wand-of-frost': wand });
    const d = derive(withInventory(equippedSlot('test-wand-of-frost')), lookup);
    const base = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));

    const bolt = d.actions.find((a) => a.id.endsWith('/wand-bolt'))!;
    expect(bolt.attackBonus).toBe(5);
    expect(bolt.attackBonus).not.toBe(base.stats.spellAttackBonus);
  });
});
