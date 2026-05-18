// Items that grant spell-cast actions (driftglobe etc.) — verifies the
// `cast-spell` activity type surfaces as an Action on the sheet, scaled
// off the holder's spellcasting stats where the spell needs them, and
// that limited-use entries (Daylight 1/day) emit Resources.

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

describe('Driftglobe (DMG) grants Cast Light + Cast Daylight', () => {
  it('produces both cast-spell actions when equipped', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: true, attuned: false }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const fromDriftglobe = d.actions.filter((a) => a.sourceContent.slug === 'driftglobe');
    expect(fromDriftglobe.length).toBe(2);

    const light = fromDriftglobe.find((a) => a.id.endsWith('/driftglobe-cast-light'));
    const daylight = fromDriftglobe.find((a) => a.id.endsWith('/driftglobe-cast-daylight'));
    expect(light).toBeDefined();
    expect(daylight).toBeDefined();
    expect(light!.cost).toBe('action');
    expect(daylight!.cost).toBe('action');

    // Daylight's spell row carries a range of 60 ft — should inline.
    expect(daylight!.range).toEqual({ value: 60, units: 'ft' });
  });

  it('emits a 1/day resource for the daylight activity', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: true, attuned: false }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const dayRes = d.resources.find((r) => r.id.endsWith('/driftglobe-cast-daylight'));
    expect(dayRes).toBeDefined();
    expect(dayRes!.max).toBe(1);
    expect(dayRes!.per).toBe('day');
  });

  it('does not mutate the character spell list or slots', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: true, attuned: false }
    ]);
    const before = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));
    const after = derive(character, chronurgy.makeLookup(PACKS));

    // Spell slots untouched
    expect(after.stats.spellSlots).toEqual(before.stats.spellSlots);
    // Light/daylight not added to known spells (character.spells unchanged in input)
    expect(character.spells.known.some((s) => s.slug === 'light')).toBe(false);
    expect(character.spells.known.some((s) => s.slug === 'daylight')).toBe(false);
  });

  it('produces no driftglobe actions when unequipped', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'driftglobe', version: 1, equipped: false, attuned: false }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const fromDriftglobe = d.actions.filter((a) => a.sourceContent.slug === 'driftglobe');
    expect(fromDriftglobe).toEqual([]);
  });
});

describe('Cracked Driftglobe (CoS) grants only Light', () => {
  it('produces a single cast-light action with no daily recharge', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'cracked-driftglobe', version: 1, equipped: true, attuned: false }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const fromCracked = d.actions.filter((a) => a.sourceContent.slug === 'cracked-driftglobe');
    expect(fromCracked.length).toBe(1);
    expect(fromCracked[0].id).toContain('cracked-driftglobe-cast-light');

    const anyDaylight = d.resources.find((r) => r.id.includes('cracked-driftglobe') && r.per === 'day');
    expect(anyDaylight).toBeUndefined();
  });
});

describe('cast-spell activity with missing spell row', () => {
  it('still emits a utility-shaped action and does not throw', () => {
    // Synthesize an inventory item that points at a fabricated content slug
    // wired through a wrapper lookup that injects the item row only.
    const fakeItem: ContentRow = {
      kind: 'item',
      slug: 'phantom-orb',
      version: 1,
      name: 'Phantom Orb',
      source: 'test',
      data: {
        itemType: 'wondrous',
        rarity: 'common',
        modifiers: [],
        activities: [
          {
            id: 'phantom-orb-cast-missing',
            type: 'cast-spell',
            name: 'Cast Missing Spell',
            cost: 'action',
            spell: { slug: 'this-spell-does-not-exist' }
          }
        ]
      }
    };
    const base = chronurgy.makeLookup(PACKS);
    const lookup = (ref: { kind: string; slug: string }) =>
      ref.kind === 'item' && ref.slug === 'phantom-orb' ? fakeItem : base(ref);

    const character = withInventory([
      { contentKind: 'item', contentSlug: 'phantom-orb', version: 1, equipped: true, attuned: false }
    ]);
    const d = derive(character, lookup);

    const phantom = d.actions.find((a) => a.sourceContent.slug === 'phantom-orb');
    expect(phantom).toBeDefined();
    expect(phantom!.name).toBe('Cast Missing Spell');
    expect(phantom!.attackBonus).toBeUndefined();
    expect(phantom!.damageRolls).toBeUndefined();
  });
});
