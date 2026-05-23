// Phase B: toggleActivation / refreshActivations /
// applyAutoCancelOnStateChange helpers. Pure functions — no I/O,
// no mutation. Verifies activation/deactivation, group mutual
// exclusion, concentration interruption, uses-tracking, refresh
// semantics, auto-cancel (condition + inventory predicate).

import { describe, it, expect } from 'vitest';
import {
  toggleActivation,
  refreshActivations,
  applyAutoCancelOnStateChange
} from '../activations';
import type { AvailableActivation, CharacterDocument, EquippedInventory } from '../types';

const NO_GEAR: EquippedInventory = { armorType: null, shield: false };

function baseChar(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'test',
    name: 'Test',
    classes: [{ slug: 'test-class', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 14, con: 14, int: 18, wis: 10, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

function avail(o: Partial<AvailableActivation> & { id: string; name: string; condition: string }): AvailableActivation {
  return {
    sourceContent: { kind: 'feature', slug: o.id },
    usesMax: null,
    usesRemaining: null,
    refreshOn: null,
    active: false,
    ...o
  };
}

const BLADESONG = avail({
  id: 'bladesong',
  name: 'Bladesong',
  cost: 'bonus',
  duration: '1 minute',
  usesMax: 3,
  usesRemaining: 3,
  refreshOn: 'long-rest',
  condition: 'bladesong-active',
  autoCancelOn: ['incapacitated']
});

const MAGIC_WEAPON = avail({
  id: 'magic-weapon-concentration',
  name: 'Magic Weapon',
  cost: 'bonus',
  duration: '1 hour',
  concentration: true,
  condition: 'magic-weapon-active'
});

const ELEMENTAL_WEAPON = avail({
  id: 'elemental-weapon-concentration',
  name: 'Elemental Weapon',
  cost: 'action',
  duration: '1 hour',
  concentration: true,
  condition: 'elemental-weapon-active'
});

const OWL_VARIANT = avail({
  id: 'aspect-of-the-wilds',
  name: 'Aspect of the Wilds',
  duration: 'persistent',
  group: 'wild-heart-aspect',
  condition: 'aspect-of-the-wilds-active',
  variants: [
    { id: 'owl', label: 'Owl' },
    { id: 'panther', label: 'Panther' }
  ]
});

const RAGE_OF_THE_WILDS_BEAR = avail({
  id: 'rage-of-the-wilds-bear',
  name: 'Rage of the Wilds (Bear)',
  cost: 'bonus',
  duration: '10 minutes',
  group: 'wild-heart-rage',
  condition: 'rage-of-the-wilds-bear-active'
});

const RAGE_OF_THE_WILDS_EAGLE = avail({
  id: 'rage-of-the-wilds-eagle',
  name: 'Rage of the Wilds (Eagle)',
  cost: 'bonus',
  duration: '10 minutes',
  group: 'wild-heart-rage',
  condition: 'rage-of-the-wilds-eagle-active'
});

describe('toggleActivation — basic on/off', () => {
  it('returns unknown when the id is not in decls', () => {
    const input = baseChar();
    const r = toggleActivation(input, [BLADESONG], 'nonsense', true);
    expect(r.outcome).toBe('unknown');
    expect(r.character).toBe(input);
  });

  it('flips active=true and decrements usesRemaining', () => {
    const r = toggleActivation(
      baseChar({ activations: { bladesong: { active: false, usesRemaining: 3 } } }),
      [BLADESONG],
      'bladesong',
      true
    );
    expect(r.outcome).toBe('activated');
    expect(r.character.activations!.bladesong.active).toBe(true);
    expect(r.character.activations!.bladesong.usesRemaining).toBe(2);
  });

  it('returns no-op when toggling on an already-on activation', () => {
    const r = toggleActivation(
      baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } }),
      [BLADESONG],
      'bladesong',
      true
    );
    expect(r.outcome).toBe('no-op');
  });

  it('returns no-uses when usesRemaining is 0', () => {
    const r = toggleActivation(
      baseChar({ activations: { bladesong: { active: false, usesRemaining: 0 } } }),
      [BLADESONG],
      'bladesong',
      true
    );
    expect(r.outcome).toBe('no-uses');
  });

  it('deactivates without refunding uses', () => {
    const r = toggleActivation(
      baseChar({ activations: { bladesong: { active: true, usesRemaining: 1 } } }),
      [BLADESONG],
      'bladesong',
      false
    );
    expect(r.outcome).toBe('deactivated');
    expect(r.character.activations!.bladesong.active).toBe(false);
    expect(r.character.activations!.bladesong.usesRemaining).toBe(1);
  });
});

describe('toggleActivation — group mutual exclusion', () => {
  it('cancels other active members of the same group', () => {
    const r = toggleActivation(
      baseChar({
        activations: {
          'rage-of-the-wilds-bear': { active: true },
          'rage-of-the-wilds-eagle': { active: false }
        }
      }),
      [RAGE_OF_THE_WILDS_BEAR, RAGE_OF_THE_WILDS_EAGLE],
      'rage-of-the-wilds-eagle',
      true
    );
    expect(r.outcome).toBe('activated');
    expect(r.character.activations!['rage-of-the-wilds-eagle'].active).toBe(true);
    expect(r.character.activations!['rage-of-the-wilds-bear'].active).toBe(false);
    expect(r.cancelledIds).toEqual(['rage-of-the-wilds-bear']);
  });

  it('does not cancel activations in a different group', () => {
    const r = toggleActivation(
      baseChar({
        activations: {
          bladesong: { active: true, usesRemaining: 2 },
          'rage-of-the-wilds-bear': { active: false }
        }
      }),
      [BLADESONG, RAGE_OF_THE_WILDS_BEAR],
      'rage-of-the-wilds-bear',
      true
    );
    expect(r.character.activations!.bladesong.active).toBe(true);
    expect(r.cancelledIds).toEqual([]);
  });
});

describe('toggleActivation — concentration interruption', () => {
  it('cancels prior concentration activation when activating a new concentration', () => {
    const r = toggleActivation(
      baseChar({
        activations: { 'magic-weapon-concentration': { active: true } },
        concentrating: { label: 'Magic Weapon' }
      }),
      [MAGIC_WEAPON, ELEMENTAL_WEAPON],
      'elemental-weapon-concentration',
      true
    );
    expect(r.outcome).toBe('activated');
    expect(r.character.activations!['elemental-weapon-concentration'].active).toBe(true);
    expect(r.character.activations!['magic-weapon-concentration'].active).toBe(false);
    expect(r.character.concentrating).toEqual({ label: 'Elemental Weapon' });
    expect(r.cancelledIds).toEqual(['magic-weapon-concentration']);
  });

  it('clears character.concentrating when deactivating the concentration source', () => {
    const r = toggleActivation(
      baseChar({
        activations: { 'magic-weapon-concentration': { active: true } },
        concentrating: { label: 'Magic Weapon' }
      }),
      [MAGIC_WEAPON],
      'magic-weapon-concentration',
      false
    );
    expect(r.character.concentrating).toBeNull();
  });

  it('keeps an unrelated concentration label when deactivating a non-concentration activation', () => {
    const r = toggleActivation(
      baseChar({
        activations: { bladesong: { active: true, usesRemaining: 2 } },
        concentrating: { label: 'Bless' } // some other spell
      }),
      [BLADESONG],
      'bladesong',
      false
    );
    expect(r.character.concentrating).toEqual({ label: 'Bless' });
  });

  it('records sinceRound on the concentration label when currentRound is provided', () => {
    const r = toggleActivation(
      baseChar(),
      [MAGIC_WEAPON],
      'magic-weapon-concentration',
      true,
      { currentRound: 4 }
    );
    expect(r.character.concentrating).toEqual({ label: 'Magic Weapon', sinceRound: 4 });
    expect(r.character.activations!['magic-weapon-concentration'].activatedAtRound).toBe(4);
  });
});

describe('toggleActivation — variants', () => {
  it('stores opts.variant on the new state', () => {
    const r = toggleActivation(
      baseChar(),
      [OWL_VARIANT],
      'aspect-of-the-wilds',
      true,
      { variant: 'owl' }
    );
    expect(r.character.activations!['aspect-of-the-wilds'].variant).toBe('owl');
  });

  it('persists the prior variant when reactivating without specifying one', () => {
    const r = toggleActivation(
      baseChar({
        activations: { 'aspect-of-the-wilds': { active: false, variant: 'panther' } }
      }),
      [OWL_VARIANT],
      'aspect-of-the-wilds',
      true
    );
    expect(r.character.activations!['aspect-of-the-wilds'].variant).toBe('panther');
  });
});

describe('refreshActivations — per-rest', () => {
  const available: AvailableActivation[] = [
    {
      id: 'bladesong',
      name: 'Bladesong',
      sourceContent: { kind: 'feature', slug: 'bladesong-shape' },
      usesMax: 3,
      usesRemaining: 0,
      refreshOn: 'long-rest',
      condition: 'bladesong-active',
      active: false
    },
    {
      id: 'second-wind',
      name: 'Second Wind',
      sourceContent: { kind: 'feature', slug: 'second-wind' },
      usesMax: 2,
      usesRemaining: 0,
      refreshOn: 'short-rest',
      condition: 'second-wind-active',
      active: false
    },
    {
      id: 'sunset-strike',
      name: 'Sunset Strike',
      sourceContent: { kind: 'feature', slug: 'sunset-strike' },
      usesMax: 1,
      usesRemaining: 0,
      refreshOn: 'day',
      condition: 'sunset-strike-active',
      active: false
    },
    {
      id: 'aspect-of-the-wilds',
      name: 'Aspect',
      sourceContent: { kind: 'feature', slug: 'aspect' },
      usesMax: null,
      usesRemaining: null,
      refreshOn: null,
      condition: 'aspect-active',
      active: false
    }
  ];

  it('long rest refreshes long-rest, short-rest, and day activations', () => {
    const char = baseChar({
      activations: {
        bladesong: { active: false, usesRemaining: 0 },
        'second-wind': { active: false, usesRemaining: 0 },
        'sunset-strike': { active: false, usesRemaining: 0 }
      }
    });
    const r = refreshActivations(char, available, 'long-rest');
    expect(r.activations!.bladesong.usesRemaining).toBe(3);
    expect(r.activations!['second-wind'].usesRemaining).toBe(2);
    expect(r.activations!['sunset-strike'].usesRemaining).toBe(1);
  });

  it('short rest refreshes only short-rest activations', () => {
    const char = baseChar({
      activations: {
        bladesong: { active: false, usesRemaining: 0 },
        'second-wind': { active: false, usesRemaining: 0 },
        'sunset-strike': { active: false, usesRemaining: 0 }
      }
    });
    const r = refreshActivations(char, available, 'short-rest');
    expect(r.activations!.bladesong.usesRemaining).toBe(0);
    expect(r.activations!['second-wind'].usesRemaining).toBe(2);
    expect(r.activations!['sunset-strike'].usesRemaining).toBe(0);
  });

  it('returns the same character reference when nothing needs refreshing', () => {
    const char = baseChar({
      activations: {
        bladesong: { active: false, usesRemaining: 3 },
        'second-wind': { active: false, usesRemaining: 2 },
        'sunset-strike': { active: false, usesRemaining: 1 }
      }
    });
    const r = refreshActivations(char, available, 'long-rest');
    expect(r).toBe(char);
  });

  it('ignores unlimited (refreshOn=null) activations', () => {
    const char = baseChar();
    const r = refreshActivations(char, available, 'long-rest');
    expect(r.activations?.['aspect-of-the-wilds']).toBeUndefined();
  });
});

describe('applyAutoCancelOnStateChange — condition predicates', () => {
  it('cancels an activation whose autoCancelOn condition is now present', () => {
    const char = baseChar({
      activations: { bladesong: { active: true, usesRemaining: 2 } },
      conditions: ['incapacitated']
    });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG], NO_GEAR);
    expect(r.activations!.bladesong.active).toBe(false);
    expect(r.activations!.bladesong.usesRemaining).toBe(2); // no refund
  });

  it('leaves activations alone when no autoCancelOn trigger is present', () => {
    const char = baseChar({
      activations: { bladesong: { active: true, usesRemaining: 2 } },
      conditions: ['prone'] // not in autoCancelOn list
    });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG], NO_GEAR);
    expect(r.activations!.bladesong.active).toBe(true);
  });

  it('is a no-op when the activation is already off', () => {
    const char = baseChar({
      activations: { bladesong: { active: false, usesRemaining: 2 } },
      conditions: ['incapacitated']
    });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG], NO_GEAR);
    expect(r.activations!.bladesong.active).toBe(false);
  });
});

describe('applyAutoCancelOnStateChange — inventory predicates', () => {
  // Bladesong with full RAW autoCancelOn: incapacitated + medium/heavy armor + shield.
  const BLADESONG_FULL: AvailableActivation = {
    ...BLADESONG,
    autoCancelOn: [
      'incapacitated',
      { wearing: 'armor.medium' },
      { wearing: 'armor.heavy' },
      { wearing: 'shield' }
    ]
  };

  it('cancels Bladesong when the character is wearing medium armor', () => {
    const char = baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG_FULL], {
      armorType: 'medium',
      shield: false
    });
    expect(r.activations!.bladesong.active).toBe(false);
  });

  it('cancels Bladesong when the character is wearing heavy armor', () => {
    const char = baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG_FULL], {
      armorType: 'heavy',
      shield: false
    });
    expect(r.activations!.bladesong.active).toBe(false);
  });

  it('cancels Bladesong when the character equips a shield', () => {
    const char = baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG_FULL], {
      armorType: 'light',
      shield: true
    });
    expect(r.activations!.bladesong.active).toBe(false);
  });

  it('leaves Bladesong active when only wearing light armor with no shield', () => {
    const char = baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG_FULL], {
      armorType: 'light',
      shield: false
    });
    expect(r.activations!.bladesong.active).toBe(true);
  });

  it('leaves Bladesong active when unarmored with no shield', () => {
    const char = baseChar({ activations: { bladesong: { active: true, usesRemaining: 2 } } });
    const r = applyAutoCancelOnStateChange(char, [BLADESONG_FULL], NO_GEAR);
    expect(r.activations!.bladesong.active).toBe(true);
  });
});
