// Spell storage pools (Ring of Spell Storing) — an equipped, attunement-
// satisfying item with `data.spellStorage: { maxLevels }` emits one cast
// Action per `InventorySlot.stored[]` entry: the spell row inlined at
// the stored level, with the storer's DC / attack bonus overriding the
// wearer's own when recorded. Capacity is a soft warning only
// (spell-storage-over-capacity), never a gate.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow, StoredSpell } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

const RING: ContentRow = {
  kind: 'item',
  slug: 'test-ring-of-spell-storing',
  version: 1,
  name: 'Test Ring of Spell Storing',
  source: 'test',
  data: {
    category: 'ring',
    rarity: 'rare',
    requiresAttunement: true,
    spellStorage: { maxLevels: 5 }
  }
};

function withRing(stored: StoredSpell[], attuned = true): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    inventory: [
      ...chronurgy.CHARACTER.inventory,
      {
        contentKind: 'item',
        contentSlug: 'test-ring-of-spell-storing',
        version: 1,
        equipped: true,
        attuned,
        stored
      }
    ]
  };
}

function makeLookup() {
  const base = chronurgy.makeLookup(PACKS);
  return (ref: { kind: string; slug: string; version?: number }) =>
    ref.kind === 'item' && ref.slug === 'test-ring-of-spell-storing' ? RING : base(ref);
}

describe('spell storage pools', () => {
  it('emits one cast action per stored entry, upcast to the stored level, with the stored DC', () => {
    const d = derive(
      withRing([{ slug: 'fireball', level: 4, dc: 17, label: 'from Vortha' }]),
      makeLookup()
    );
    const cast = d.actions.find(
      (a) => a.id === 'item/test-ring-of-spell-storing/stored/0/fireball'
    );
    expect(cast).toBeDefined();
    expect(cast!.sourceContent).toEqual({ kind: 'item', slug: 'test-ring-of-spell-storing' });
    expect(cast!.name).toBe('Fireball (stored)');
    // 8d6 base + 1 slot above L3 → 9d6, and the storer's DC 17.
    expect(cast!.damageRolls).toEqual([{ formula: '9d6', type: 'fire' }]);
    expect(cast!.saveDC).toEqual({ ability: 'dex', value: 17 });
    // Cast level is fixed by the storer — no re-scaling in the planner.
    expect(cast!.upcastScaling).toBeUndefined();
    // Validation-free summary of the stored level + attribution.
    expect(cast!.description).toBe(
      'Cast at level 4 from Test Ring of Spell Storing (from Vortha).'
    );
  });

  it("falls back to the wearer's own DC / attack bonus when the entry records none", () => {
    const d = derive(withRing([{ slug: 'fireball', level: 3 }]), makeLookup());
    const cast = d.actions.find(
      (a) => a.id === 'item/test-ring-of-spell-storing/stored/0/fireball'
    );
    expect(cast!.damageRolls).toEqual([{ formula: '8d6', type: 'fire' }]);
    expect(cast!.saveDC).toEqual({ ability: 'dex', value: d.stats.spellSaveDC! });
  });

  it("overrides the attack bonus with the storer's number on attack spells", () => {
    const d = derive(
      withRing([{ slug: 'guiding-bolt', level: 2, attackBonus: 9 }]),
      makeLookup()
    );
    const cast = d.actions.find(
      (a) => a.id === 'item/test-ring-of-spell-storing/stored/0/guiding-bolt'
    );
    expect(cast).toBeDefined();
    expect(cast!.attackBonus).toBe(9);
    // Guiding Bolt stored at L2: 4d6 + 1d6 radiant. The +5 is the
    // wearer's spellcasting mod — the inline attack.damage path folds it
    // in (pre-existing engine behavior, same as the wearer's own cast).
    expect(cast!.damageRolls).toEqual([{ formula: '5d6+5', type: 'radiant' }]);
  });

  it('emits spell-storage-over-capacity when Σ levels exceeds maxLevels (soft, actions still realize)', () => {
    const over = derive(
      withRing([
        { slug: 'fireball', level: 3 },
        { slug: 'lightning-bolt', level: 3 }
      ]),
      makeLookup()
    );
    const warning = over.validations.find((v) => v.code === 'spell-storage-over-capacity');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
    expect(warning!.message).toContain('6 spell levels (capacity 5)');
    // Both casts still realize — capacity never gates.
    expect(
      over.actions.filter((a) => a.id.includes('/stored/')).map((a) => a.name).sort()
    ).toEqual(['Fireball (stored)', 'Lightning Bolt (stored)']);

    const within = derive(
      withRing([
        { slug: 'fireball', level: 3 },
        { slug: 'guiding-bolt', level: 2 }
      ]),
      makeLookup()
    );
    expect(within.validations.some((v) => v.code === 'spell-storage-over-capacity')).toBe(false);
  });

  it('an unattuned requiresAttunement item emits no stored-spell actions', () => {
    const d = derive(withRing([{ slug: 'fireball', level: 3 }], false), makeLookup());
    expect(d.actions.some((a) => a.id.includes('/stored/'))).toBe(false);
  });
});
