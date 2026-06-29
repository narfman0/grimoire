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
    // Driftglobe's daylight not added to known spells (character.spells unchanged in input)
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

// Locks the Phase 1b item-enhancement reroute: stat-modifier rows with
// `attack.bonus[.*]` / `damage.bonus[.*]` targets on item sources used to
// silently no-op because applyTarget never reads those character-level
// targets. derive() now synthesizes scoped action-modifiers so the bonus
// flows through applyActionEffect's attack.roll / damage.bonus paths.
describe('item enhancement bonus on attacks (Phase 1b)', () => {
  function fakeItem(slug: string, name: string, modifiers: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): ContentRow {
    return {
      kind: 'item',
      slug,
      version: 1,
      name,
      source: 'test',
      data: {
        category: 'weapon',
        weaponType: 'martial-melee',
        properties: [],
        activities: [
          {
            id: `${slug}-attack`,
            type: 'attack',
            name: `${name} Attack`,
            cost: 'action',
            attack: {
              ability: 'str',
              classification: 'weapon',
              range: 'melee',
              damage: [{ dice: '1d8', type: 'slashing' }]
            }
          }
        ],
        modifiers,
        ...extra
      }
    };
  }

  function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
    const base = chronurgy.makeLookup(packs);
    return (ref: { kind: string; slug: string; version?: number }) => {
      const key = `${ref.kind}/${ref.slug}`;
      return extras[key] ?? base(ref);
    };
  }

  it('applies bare attack.bonus + damage.bonus from a +1 weapon to its own attack', () => {
    const plusOne = fakeItem('test-longsword-plus-1', '+1 Longsword', [
      { kind: 'stat-modifier', target: 'attack.bonus', mode: 'ADD', value: 1 },
      { kind: 'stat-modifier', target: 'damage.bonus', mode: 'ADD', value: 1 }
    ]);
    const lookup = wrapLookup(PACKS, { 'item/test-longsword-plus-1': plusOne });
    const baseline = fakeItem('test-longsword-mundane', 'Test Longsword', []);
    const baselineLookup = wrapLookup(PACKS, { 'item/test-longsword-mundane': baseline });

    const enhanced = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-longsword-plus-1', version: 1, equipped: true, attuned: false }]),
      lookup
    );
    const plain = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-longsword-mundane', version: 1, equipped: true, attuned: false }]),
      baselineLookup
    );

    const enhancedAttack = enhanced.actions.find((a) => a.sourceContent.slug === 'test-longsword-plus-1');
    const plainAttack = plain.actions.find((a) => a.sourceContent.slug === 'test-longsword-mundane');
    expect(enhancedAttack).toBeDefined();
    expect(plainAttack).toBeDefined();

    // attack bonus bumped by exactly 1
    expect(enhancedAttack!.attackBonus).toBe(plainAttack!.attackBonus! + 1);

    // damage formula gained +1 on the first roll
    const plainDmg = plainAttack!.damageRolls![0].formula; // "1d8" or "1d8+X"
    const enhancedDmg = enhancedAttack!.damageRolls![0].formula;
    // Tail integer of enhancedDmg should be exactly one more than plainDmg's tail
    const tail = (f: string) => {
      const m = f.match(/([+-]\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    };
    expect(tail(enhancedDmg)).toBe(tail(plainDmg) + 1);

    // audit trail surfaces the synthetic modifier
    const audit = enhancedAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(audit.some((id) => id.endsWith('/item-action-bonus'))).toBe(true);
  });

  it('attack.bonus.melee fires on a melee weapon attack', () => {
    const item = fakeItem('test-mw-melee', 'Melee-Only Bonus', [
      { kind: 'stat-modifier', target: 'attack.bonus.melee', mode: 'ADD', value: 2 }
    ]);
    const lookup = wrapLookup(PACKS, { 'item/test-mw-melee': item });
    const d = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-mw-melee', version: 1, equipped: true, attuned: false }]),
      lookup
    );
    const baseline = derive(
      withInventory([
        { contentKind: 'item', contentSlug: 'test-mw-melee', version: 1, equipped: true, attuned: false }
      ]),
      wrapLookup(PACKS, { 'item/test-mw-melee': fakeItem('test-mw-melee', 'Plain', []) })
    );
    const got = d.actions.find((a) => a.sourceContent.slug === 'test-mw-melee')!;
    const base = baseline.actions.find((a) => a.sourceContent.slug === 'test-mw-melee')!;
    expect(got.attackBonus).toBe(base.attackBonus! + 2);
  });

  it('attack.bonus.ranged does NOT fire on a melee weapon attack', () => {
    const item = fakeItem('test-mw-ranged-only', 'Ranged-Only Bonus', [
      { kind: 'stat-modifier', target: 'attack.bonus.ranged', mode: 'ADD', value: 5 }
    ]);
    const lookup = wrapLookup(PACKS, { 'item/test-mw-ranged-only': item });
    const baseline = wrapLookup(PACKS, {
      'item/test-mw-ranged-only': fakeItem('test-mw-ranged-only', 'Plain', [])
    });
    const enhanced = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-mw-ranged-only', version: 1, equipped: true, attuned: false }]),
      lookup
    );
    const plain = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-mw-ranged-only', version: 1, equipped: true, attuned: false }]),
      baseline
    );
    const got = enhanced.actions.find((a) => a.sourceContent.slug === 'test-mw-ranged-only')!;
    const base = plain.actions.find((a) => a.sourceContent.slug === 'test-mw-ranged-only')!;
    expect(got.attackBonus).toBe(base.attackBonus!);
  });

  it('attack.bonus.spell from an equipped focus bumps spell-attack rolls', () => {
    const focus = {
      kind: 'item' as const,
      slug: 'test-wand-of-power',
      version: 1,
      name: 'Test Wand of Power',
      source: 'test',
      data: {
        category: 'wondrous',
        modifiers: [
          { kind: 'stat-modifier', target: 'attack.bonus.spell', mode: 'ADD', value: 2 }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-wand-of-power': focus });
    const enhanced = derive(
      withInventory([{ contentKind: 'item', contentSlug: 'test-wand-of-power', version: 1, equipped: true, attuned: false }]),
      lookup
    );
    const plain = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));

    const enhancedBolt = enhanced.actions.find((a) => a.sourceContent.slug === 'fire-bolt' && a.attackBonus != null);
    const plainBolt = plain.actions.find((a) => a.sourceContent.slug === 'fire-bolt' && a.attackBonus != null);
    expect(enhancedBolt).toBeDefined();
    expect(plainBolt).toBeDefined();
    expect(enhancedBolt!.attackBonus).toBe(plainBolt!.attackBonus! + 2);
  });

  it('does not bleed an item bonus onto a different equipped weapon', () => {
    const plusOne = fakeItem('test-sword-a', '+1 Sword A', [
      { kind: 'stat-modifier', target: 'attack.bonus', mode: 'ADD', value: 1 }
    ]);
    const mundane = fakeItem('test-sword-b', 'Sword B', []);
    const lookup = wrapLookup(PACKS, {
      'item/test-sword-a': plusOne,
      'item/test-sword-b': mundane
    });
    const d = derive(
      withInventory([
        { contentKind: 'item', contentSlug: 'test-sword-a', version: 1, equipped: true, attuned: false },
        { contentKind: 'item', contentSlug: 'test-sword-b', version: 1, equipped: true, attuned: false }
      ]),
      lookup
    );
    const baseline = derive(
      withInventory([
        { contentKind: 'item', contentSlug: 'test-sword-b', version: 1, equipped: true, attuned: false }
      ]),
      wrapLookup(PACKS, { 'item/test-sword-b': mundane })
    );
    const swordA = d.actions.find((a) => a.sourceContent.slug === 'test-sword-a')!;
    const swordB = d.actions.find((a) => a.sourceContent.slug === 'test-sword-b')!;
    const baseB = baseline.actions.find((a) => a.sourceContent.slug === 'test-sword-b')!;
    // Sword A gains +1, Sword B is unaffected by Sword A's enhancement
    expect(swordA.attackBonus).toBe(swordB.attackBonus! + 1);
    expect(swordB.attackBonus).toBe(baseB.attackBonus!);
  });
});

describe('Lunar Dragon Raiment (Spelljammer) — Ray of Frost at will + resistances', () => {
  it('produces a Ray of Frost cast-spell action when equipped and attuned', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'lunar-dragon-raiment', version: 1, equipped: true, attuned: true }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const fromLDR = d.actions.filter((a) => a.sourceContent.slug === 'lunar-dragon-raiment');
    expect(fromLDR.length).toBeGreaterThanOrEqual(1);

    const rayOfFrost = fromLDR.find((a) => a.id.endsWith('/ldr-cast-ray-of-frost'));
    expect(rayOfFrost).toBeDefined();
    expect(rayOfFrost!.cost).toBe('action');
  });

  it('Ray of Frost is at-will — no uses resource emitted', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'lunar-dragon-raiment', version: 1, equipped: true, attuned: true }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const res = d.resources.find((r) => r.id.includes('ldr-cast-ray-of-frost'));
    expect(res).toBeUndefined();
  });

  it('grants cold and fire resistance when equipped and attuned', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'lunar-dragon-raiment', version: 1, equipped: true, attuned: true }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    expect(d.stats.resistances).toContain('cold');
    expect(d.stats.resistances).toContain('fire');
  });
});

describe('Elven Scorn (Spelljammer) — two damage rolls (1d10 + 2d6 piercing)', () => {
  it('attack action has both 1d10 and 2d6 piercing damage rolls', () => {
    const character = withInventory([
      { contentKind: 'item', contentSlug: 'elven-scorn', version: 1, equipped: true, attuned: true }
    ]);
    const d = derive(character, chronurgy.makeLookup(PACKS));

    const attack = d.actions.find((a) => a.sourceContent.slug === 'elven-scorn');
    expect(attack).toBeDefined();
    expect(attack!.damageRolls).toBeDefined();
    expect(attack!.damageRolls!.length).toBeGreaterThanOrEqual(2);

    const allPiercing = attack!.damageRolls!.filter((r) => r.type === 'piercing');
    expect(allPiercing.length).toBeGreaterThanOrEqual(2);

    const hasPike = allPiercing.some((r) => r.formula.includes('1d10'));
    const hasBonus = allPiercing.some((r) => r.formula.includes('2d6'));
    expect(hasPike).toBe(true);
    expect(hasBonus).toBe(true);
  });
});

describe('Polearm Master feat — bonus attack flag on reach weapon attacks', () => {
  it('flag.polearm-master-bonus-attack appears on the feat content row', () => {
    const featRow = chronurgy.makeLookup(PACKS)({ kind: 'feat', slug: 'polearm-master' });
    expect(featRow).toBeDefined();

    const mods = (featRow!.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    const flagMod = mods.find(
      (m) => m.kind === 'action-modifier' && m.id === 'polearm-master-bonus-attack'
    );
    expect(flagMod).toBeDefined();

    const effects = flagMod!.effects as Array<{ target: string; value: unknown }>;
    const flagEffect = effects.find((e) => e.target === 'flag.polearm-master-bonus-attack');
    expect(flagEffect).toBeDefined();
    expect(flagEffect!.value).toBe(true);
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

describe('Shield AC bonus', () => {
  it('adds +2 AC exactly once when a shield is equipped alongside armor', () => {
    // Regression: shield +2 was applied twice — once via direct shield block
    // in computeAC and once via applyTarget(mods, 'ac', ...) — producing +4.
    const character: CharacterDocument = {
      ...chronurgy.CHARACTER,
      // tortle has no armor, base AC = 17 (natural armor formula 17)
      inventory: [
        { contentKind: 'item', contentSlug: 'shield', version: 1, equipped: true, attuned: false, slot: 'offHand' }
      ]
    };
    const d = derive(character, chronurgy.makeLookup(PACKS));
    // Tortle natural armor = 17; shield = +2; total = 19 (not 21).
    expect(d.stats.ac).toBe(19);
  });
});
