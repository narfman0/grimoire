// Item choice slots — `data.choices` on an item row declares per-
// inventory-slot player picks (a Spell Scroll whose spell the player
// chooses, a generic-variant weapon's base weapon). Picks live on
// `InventorySlot.choices`, so two copies of the same item can hold
// different picks. Activities reference picks parametrically:
// `spell: { fromChoice: 'spell' }` resolves the picked slug at realize
// time; unpicked → the action realizes as a stub with `needsChoice` and
// no warning. Derived.pendingItemChoices surfaces every declared slot.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow, InventorySlot } from '../types';

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

/** A parametric spell scroll: the player picks which 3rd-level spell is
 *  inscribed; the cast activity inlines the pick with a literal DC 15. */
const SCROLL: ContentRow = {
  kind: 'item',
  slug: 'test-parametric-scroll',
  version: 1,
  name: 'Test Parametric Scroll',
  source: 'test',
  data: {
    category: 'consumable',
    choices: {
      spell: { label: 'Inscribed spell', maxLevel: 3, allowedSchools: ['evocation'] }
    },
    activities: [
      {
        id: 'scroll-cast',
        type: 'cast-spell',
        name: 'Cast Inscribed Spell',
        cost: 'action',
        spell: { fromChoice: 'spell' },
        spellOverrides: { saveDC: 15 }
      }
    ]
  }
};

function scrollSlot(choices?: Record<string, unknown>): InventorySlot {
  return {
    contentKind: 'item',
    contentSlug: 'test-parametric-scroll',
    version: 1,
    equipped: true,
    attuned: false,
    ...(choices ? { choices } : {})
  };
}

describe('item spell choice slots', () => {
  it('resolves spell.fromChoice to the picked slug and composes with spellOverrides', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-scroll': SCROLL });
    const d = derive(withInventory([scrollSlot({ spell: 'fireball' })]), lookup);

    const cast = d.actions.find((a) => a.id === 'item/test-parametric-scroll/scroll-cast');
    expect(cast).toBeDefined();
    // Inlined from Fireball's primary activity…
    expect(cast!.damageRolls).toEqual([{ formula: '8d6', type: 'fire' }]);
    expect(cast!.saveDC?.ability).toBe('dex');
    // …with the authored literal DC replacing the character-derived one.
    expect(cast!.saveDC?.value).toBe(15);
    expect(cast!.needsChoice).toBeUndefined();
  });

  it('unpicked → stub action with needsChoice, no inline, and no warning', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-scroll': SCROLL });
    const base = derive(withInventory([]), lookup);
    const d = derive(withInventory([scrollSlot()]), lookup);

    const cast = d.actions.find((a) => a.id === 'item/test-parametric-scroll/scroll-cast');
    expect(cast).toBeDefined();
    expect(cast!.needsChoice).toBe('spell');
    expect(cast!.damageRolls).toBeUndefined();
    expect(cast!.saveDC).toBeUndefined();
    expect(cast!.attackBonus).toBeUndefined();
    // No new validation warnings versus the same character without the scroll.
    expect(d.validations).toEqual(base.validations);
  });

  it('surfaces every declared slot on pendingItemChoices with the recorded pick', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-scroll': SCROLL });
    const character = withInventory([scrollSlot({ spell: 'fireball' }), scrollSlot()]);
    const d = derive(character, lookup);

    const entries = d.pendingItemChoices.filter((p) => p.itemSlug === 'test-parametric-scroll');
    expect(entries).toHaveLength(2);
    const baseIndex = chronurgy.CHARACTER.inventory.length;
    const picked = entries.find((p) => p.slotIndex === baseIndex);
    const unpicked = entries.find((p) => p.slotIndex === baseIndex + 1);
    expect(picked).toMatchObject({
      itemName: 'Test Parametric Scroll',
      choice: 'spell',
      picked: 'fireball'
    });
    expect(picked!.declaration).toMatchObject({ maxLevel: 3 });
    expect(unpicked).toBeDefined();
    expect(unpicked!.picked).toBeUndefined();
  });

  it('two copies of the same item hold independent picks', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-scroll': SCROLL });
    const d = derive(
      withInventory([scrollSlot({ spell: 'fireball' }), scrollSlot({ spell: 'lightning-bolt' })]),
      lookup
    );

    const casts = d.actions.filter((a) => a.id === 'item/test-parametric-scroll/scroll-cast');
    expect(casts).toHaveLength(2);
    const types = casts.map((c) => c.damageRolls?.[0]?.type).sort();
    expect(types).toEqual(['fire', 'lightning']);
  });

  it('unequipped items surface no pendingItemChoices', () => {
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-scroll': SCROLL });
    const d = derive(
      withInventory([{ ...scrollSlot({ spell: 'fireball' }), equipped: false }]),
      lookup
    );
    expect(d.pendingItemChoices.some((p) => p.itemSlug === 'test-parametric-scroll')).toBe(false);
  });

  it('composes with item charge pools (chargeCost debits the shared pool)', () => {
    const charged: ContentRow = {
      ...SCROLL,
      slug: 'test-parametric-wand',
      name: 'Test Parametric Wand',
      data: {
        ...SCROLL.data,
        charges: { max: 3, recharge: { per: 'dawn' } },
        activities: [
          {
            ...(SCROLL.data.activities as Array<Record<string, unknown>>)[0],
            chargeCost: 1
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-parametric-wand': charged });
    const d = derive(
      withInventory([
        { ...scrollSlot({ spell: 'fireball' }), contentSlug: 'test-parametric-wand' }
      ]),
      lookup
    );
    const cast = d.actions.find((a) => a.id === 'item/test-parametric-wand/scroll-cast');
    expect(cast!.spendsResource).toBe('item/test-parametric-wand/charges');
    expect(cast!.resourceCost).toBe(1);
    expect(cast!.damageRolls?.[0]).toEqual({ formula: '8d6', type: 'fire' });
  });
});
