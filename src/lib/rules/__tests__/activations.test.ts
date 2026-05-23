// Activation primitive (Phase A): declaration → derived manifest →
// condition injection → variant synthesis. Covers Bladesong-shape
// passive modifiers, Form of Dread per-rest uses, Aspect of the
// Wilds variant pick.
//
// Authored on a feature row's `data.activations[]`. Character carries
// state in `character.activations[id] = { active, usesRemaining,
// variant? }`. derive() emits `Derived.availableActivations[]` for
// the sheet AND auto-injects the activation's `condition` slug into
// ctx.resolvedConditions when active=true (so existing
// appliesWhen.condition modifiers fire).

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const SYNTH_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: { hitDie: 8, primaryAbility: 'int', savingThrows: ['int', 'wis'] }
};

const SYNTH_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'test-subclass',
  version: 1,
  source: 'test',
  name: 'Test Subclass',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [
      { level: 1, name: 'Bladesong Shape' },
      { level: 1, name: 'Form of Dread Shape' },
      { level: 1, name: 'Aspect of the Wilds Shape' }
    ]
  }
};

const SYNTH_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

// Bladesong-shape: condition-gated stat-modifier ac +intMod when active.
const BLADESONG_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'bladesong-shape',
  version: 1,
  source: 'test',
  name: 'Bladesong Shape',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    activations: [
      {
        id: 'bladesong',
        name: 'Bladesong',
        cost: 'bonus',
        duration: { value: 1, units: 'minute' },
        uses: { max: 'proficiencyBonus', per: 'long-rest' },
        condition: 'bladesong-active'
      }
    ],
    modifiers: [
      {
        kind: 'stat-modifier',
        target: 'ac',
        mode: 'ADD',
        value: 'max(1, intMod)',
        appliesWhen: { condition: 'bladesong-active' }
      }
    ]
  }
};

// Form of Dread-shape: per-rest uses, condition gates immunity.
const FORM_OF_DREAD_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'form-of-dread-shape',
  version: 1,
  source: 'test',
  name: 'Form of Dread Shape',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    activations: [
      {
        id: 'form-of-dread',
        name: 'Form of Dread',
        cost: 'bonus',
        duration: { value: 1, units: 'minute' },
        uses: { max: 'proficiencyBonus', per: 'long-rest' },
        condition: 'form-of-dread-active'
      }
    ],
    modifiers: [
      {
        kind: 'stat-modifier',
        target: 'immunity.frightened',
        mode: 'OVERRIDE',
        value: true,
        appliesWhen: { condition: 'form-of-dread-active' }
      }
    ]
  }
};

// Aspect of the Wilds-shape: activation with variants[]. Variant
// modifiers fire ONLY when active AND a variant is picked.
const ASPECT_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'aspect-of-the-wilds-shape',
  version: 1,
  source: 'test',
  name: 'Aspect of the Wilds Shape',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'test-subclass',
    minLevel: 1,
    activations: [
      {
        id: 'aspect-of-the-wilds',
        name: 'Aspect of the Wilds',
        cost: 'none',
        duration: 'persistent',
        condition: 'aspect-of-the-wilds-active',
        variants: [
          {
            id: 'owl',
            label: 'Owl',
            modifiers: [{ kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }]
          },
          {
            id: 'panther',
            label: 'Panther',
            modifiers: [{ kind: 'stat-modifier', target: 'speed.climb', mode: 'UPGRADE', value: 'walkSpeed' }]
          }
        ]
      }
    ]
  }
};

function makeLookup(): ContentLookup {
  const rows: ContentRow[] = [
    SYNTH_CLASS,
    SYNTH_SUBCLASS,
    SYNTH_SPECIES,
    BLADESONG_FEATURE,
    FORM_OF_DREAD_FEATURE,
    ASPECT_FEATURE
  ];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(
  activations?: Record<string, { active: boolean; usesRemaining?: number; variant?: string }>
): CharacterDocument {
  return {
    id: 'test-activations',
    name: 'Test',
    classes: [{ slug: 'test-class', level: 5, subclass: 'test-subclass', hpRolledPerLevel: [8, 5, 5, 5, 5] }],
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
    activations
  };
}

describe('Derived.availableActivations — declaration + state mapping', () => {
  it('emits an entry per declared activation with name / cost / duration / source', () => {
    const d = derive(baseCharacter(), makeLookup());
    const bladesong = d.availableActivations.find((a) => a.id === 'bladesong');
    expect(bladesong).toBeDefined();
    expect(bladesong!.name).toBe('Bladesong');
    expect(bladesong!.cost).toBe('bonus');
    expect(bladesong!.duration).toBe('1 minute');
    expect(bladesong!.condition).toBe('bladesong-active');
    expect(bladesong!.sourceContent).toEqual({ kind: 'feature', slug: 'bladesong-shape' });
  });

  it('starts active=false and usesRemaining=usesMax when no character state', () => {
    const d = derive(baseCharacter(), makeLookup());
    const fod = d.availableActivations.find((a) => a.id === 'form-of-dread')!;
    // L5 PB = 3 → max 3 uses, no state → remaining 3
    expect(fod.usesMax).toBe(3);
    expect(fod.usesRemaining).toBe(3);
    expect(fod.refreshOn).toBe('long-rest');
    expect(fod.active).toBe(false);
  });

  it('respects character.activations state (active, usesRemaining)', () => {
    const d = derive(
      baseCharacter({ 'form-of-dread': { active: true, usesRemaining: 1 } }),
      makeLookup()
    );
    const fod = d.availableActivations.find((a) => a.id === 'form-of-dread')!;
    expect(fod.active).toBe(true);
    expect(fod.usesRemaining).toBe(1);
    expect(fod.usesMax).toBe(3);
  });

  it('emits no entries when the active content has no activations[]', () => {
    const d = derive(baseCharacter(), makeLookup());
    // Sanity — only the three test features ship activations
    expect(d.availableActivations.map((a) => a.id).sort()).toEqual([
      'aspect-of-the-wilds',
      'bladesong',
      'form-of-dread'
    ]);
  });
});

describe('Activation gating — condition injection into resolvedConditions', () => {
  it('does NOT apply the Bladesong AC bonus when bladesong is inactive', () => {
    const baseline = derive(baseCharacter(), makeLookup());
    const bladesong = derive(
      baseCharacter({ bladesong: { active: false, usesRemaining: 3 } }),
      makeLookup()
    );
    expect(bladesong.stats.ac).toBe(baseline.stats.ac);
  });

  it('applies the Bladesong AC bonus when bladesong is active', () => {
    const baseline = derive(baseCharacter(), makeLookup());
    const buffed = derive(
      baseCharacter({ bladesong: { active: true, usesRemaining: 2 } }),
      makeLookup()
    );
    // INT 18 → mod 4 → +4 AC
    expect(buffed.stats.ac).toBe(baseline.stats.ac + 4);
  });

  it('applies Form of Dread immunity.frightened only when active', () => {
    const off = derive(
      baseCharacter({ 'form-of-dread': { active: false } }),
      makeLookup()
    );
    expect(off.stats.immunities).not.toContain('frightened');

    const on = derive(
      baseCharacter({ 'form-of-dread': { active: true } }),
      makeLookup()
    );
    expect(on.stats.immunities).toContain('frightened');
  });
});

describe('Activation variants — variant modifier synthesis', () => {
  it('emits no variant modifiers when active=false', () => {
    const baseline = derive(baseCharacter(), makeLookup());
    const inactive = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: false, variant: 'owl' } }),
      makeLookup()
    );
    expect(inactive.stats.senses.darkvision).toBe(baseline.stats.senses.darkvision);
  });

  it('emits no variant modifiers when active=true but no variant picked', () => {
    const baseline = derive(baseCharacter(), makeLookup());
    const noVariant = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: true } }),
      makeLookup()
    );
    expect(noVariant.stats.senses.darkvision).toBe(baseline.stats.senses.darkvision);
  });

  it('emits Owl darkvision modifier when active + variant=owl', () => {
    const owl = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: true, variant: 'owl' } }),
      makeLookup()
    );
    expect(owl.stats.senses.darkvision).toBe(60);
    expect(owl.stats.speeds.climb).toBeUndefined();
  });

  it('emits Panther climb modifier when active + variant=panther', () => {
    const panther = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: true, variant: 'panther' } }),
      makeLookup()
    );
    expect(panther.stats.speeds.climb).toBe(panther.stats.speeds.walk);
    expect(panther.stats.senses.darkvision).toBeUndefined();
  });

  it('exposes the picked variant on the manifest entry for the sheet', () => {
    const d = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: true, variant: 'panther' } }),
      makeLookup()
    );
    const aspect = d.availableActivations.find((a) => a.id === 'aspect-of-the-wilds')!;
    expect(aspect.activeVariant).toBe('panther');
    expect(aspect.variants).toEqual([
      { id: 'owl', label: 'Owl' },
      { id: 'panther', label: 'Panther' }
    ]);
  });

  it('drops a variant pick that does not match any declared variant', () => {
    const baseline = derive(baseCharacter(), makeLookup());
    const bogus = derive(
      baseCharacter({ 'aspect-of-the-wilds': { active: true, variant: 'eagle' } }),
      makeLookup()
    );
    // No matching variant → no modifiers synthesized
    expect(bogus.stats.senses.darkvision).toBe(baseline.stats.senses.darkvision);
    expect(bogus.stats.speeds.climb).toBeUndefined();
  });
});

describe('usesMax evaluation against character context', () => {
  it('resolves "proficiencyBonus" against the actual PB (L5 = +3)', () => {
    const d = derive(baseCharacter(), makeLookup());
    const fod = d.availableActivations.find((a) => a.id === 'form-of-dread')!;
    expect(fod.usesMax).toBe(3);
  });

  it('resolves "persistent" duration as the display string', () => {
    const d = derive(baseCharacter(), makeLookup());
    const aspect = d.availableActivations.find((a) => a.id === 'aspect-of-the-wilds')!;
    expect(aspect.duration).toBe('persistent');
  });

  it('returns null usesMax when no uses are declared (unlimited)', () => {
    const d = derive(baseCharacter(), makeLookup());
    const aspect = d.availableActivations.find((a) => a.id === 'aspect-of-the-wilds')!;
    expect(aspect.usesMax).toBeNull();
    expect(aspect.refreshOn).toBeNull();
  });

  // Locks the perClass-table activation contract that rage depends on:
  // rage's RAW uses are a hardcoded {2,2,3,3,3,4,…,99} table indexed by
  // barbarian level, not a clean formula. evaluateValue already handles
  // the shape for activity-level uses; this asserts the activation
  // primitive routes through the same path.
  it('resolves uses.max as a perClass-table indexed by class level', () => {
    const ragerCharacter = (barbLevel: number): CharacterDocument => ({
      ...baseCharacter(),
      classes: [
        {
          slug: 'test-class',
          level: barbLevel,
          subclass: 'test-subclass',
          hpRolledPerLevel: Array(barbLevel).fill(8)
        }
      ]
    });
    const RAGE_LIKE_FEATURE: ContentRow = {
      kind: 'feature',
      slug: 'rage-like',
      version: 1,
      source: 'test',
      name: 'Rage-Like',
      data: {
        ownerKind: 'class',
        ownerSlug: 'test-class',
        minLevel: 1,
        activations: [
          {
            id: 'rage-like',
            name: 'Rage-Like',
            cost: 'bonus',
            duration: { value: 1, units: 'minute' },
            uses: {
              max: { perClass: 'test-class', table: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4] },
              per: 'long-rest'
            },
            condition: 'rage-like-active'
          }
        ],
        modifiers: []
      }
    };
    // Class row that lists the rage-like feature — without this the
    // feature-walk in derive() never reaches it.
    const RAGE_CLASS: ContentRow = {
      ...SYNTH_CLASS,
      data: { ...SYNTH_CLASS.data, features: ['rage-like'] }
    };
    const lookup: ContentLookup = (ref) => {
      const map = new Map<string, ContentRow>([
        [`class/test-class`, RAGE_CLASS],
        [`subclass/test-subclass`, SYNTH_SUBCLASS],
        [`species/test-species`, SYNTH_SPECIES],
        [`feature/rage-like`, RAGE_LIKE_FEATURE]
      ]);
      return map.get(`${ref.kind}/${ref.slug}`);
    };
    const l1 = derive(ragerCharacter(1), lookup).availableActivations.find(
      (a) => a.id === 'rage-like'
    )!;
    expect(l1.usesMax).toBe(2);
    const l3 = derive(ragerCharacter(3), lookup).availableActivations.find(
      (a) => a.id === 'rage-like'
    )!;
    expect(l3.usesMax).toBe(3);
    const l6 = derive(ragerCharacter(6), lookup).availableActivations.find(
      (a) => a.id === 'rage-like'
    )!;
    expect(l6.usesMax).toBe(4);
  });
});

// Locks the per-weapon dynamic variants contract: a spell row with
// `variantsFromWeapons.modifiers` template generates one variant per
// equipped weapon in the character's inventory; activation + variant
// pick synthesizes an action-modifier whose `weapon.slug` predicate
// matches only the chosen weapon. Powers Magic Weapon / Elemental
// Weapon's "touched weapon" semantics.
describe('variantsFromWeapons (per-weapon dynamic variants)', () => {
  const LONGSWORD: ContentRow = {
    kind: 'item',
    slug: 'longsword',
    version: 1,
    source: 'test',
    name: 'Longsword',
    data: {
      category: 'weapon',
      weaponType: 'martial',
      activities: [
        {
          id: 'attack',
          type: 'attack',
          name: 'Longsword',
          cost: 'action',
          attackRange: 'melee',
          attackAbility: 'str',
          damage: { parts: [{ dice: '1d8', type: 'slashing' }] }
        }
      ]
    }
  };
  const DAGGER: ContentRow = {
    kind: 'item',
    slug: 'dagger',
    version: 1,
    source: 'test',
    name: 'Dagger',
    data: {
      category: 'weapon',
      weaponType: 'simple',
      activities: [
        {
          id: 'attack',
          type: 'attack',
          name: 'Dagger',
          cost: 'action',
          attackRange: 'melee',
          attackAbility: 'str',
          damage: { parts: [{ dice: '1d4', type: 'piercing' }] }
        }
      ]
    }
  };
  const MAGIC_WEAPON_FEATURE: ContentRow = {
    kind: 'feature',
    slug: 'magic-weapon-shape',
    version: 1,
    source: 'test',
    name: 'Magic Weapon Shape',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'test-subclass',
      minLevel: 1,
      activations: [
        {
          id: 'magic-weapon-active',
          name: 'Magic Weapon',
          cost: 'bonus',
          duration: { value: 1, units: 'hour' },
          condition: 'magic-weapon-active',
          variantsFromWeapons: {
            modifiers: [
              {
                kind: 'action-modifier',
                id: 'magic-weapon-attack-bonus',
                appliesTo: {
                  activityType: 'attack',
                  predicates: [{ 'weapon.slug': '__weapon__' }]
                },
                effects: [{ target: 'attack.roll', mode: 'ADD', value: 1 }]
              }
            ]
          }
        }
      ]
    }
  };
  // Pull the Magic Weapon feature in via the class's features list —
  // mirrors how SRD spell rows would attach via a known spell list.
  const MW_CLASS: ContentRow = {
    ...SYNTH_CLASS,
    data: { ...SYNTH_CLASS.data, features: ['magic-weapon-shape'] }
  };
  function lookup(): ContentLookup {
    const map = new Map<string, ContentRow>([
      ['class/test-class', MW_CLASS],
      ['subclass/test-subclass', SYNTH_SUBCLASS],
      ['species/test-species', SYNTH_SPECIES],
      ['feature/magic-weapon-shape', MAGIC_WEAPON_FEATURE],
      ['item/longsword', LONGSWORD],
      ['item/dagger', DAGGER]
    ]);
    return (ref) => map.get(`${ref.kind}/${ref.slug}`);
  }
  function characterWithGear(
    activations?: Record<string, { active: boolean; usesRemaining?: number; variant?: string }>,
    extraInventory: Array<{ slug: string }> = []
  ): CharacterDocument {
    return {
      ...baseCharacter(activations),
      inventory: [
        { contentKind: 'item', contentSlug: 'longsword', equipped: true, attuned: false },
        { contentKind: 'item', contentSlug: 'dagger', equipped: true, attuned: false },
        ...extraInventory.map((i) => ({
          contentKind: 'item' as const,
          contentSlug: i.slug,
          equipped: true,
          attuned: false
        }))
      ],
      classes: [{ slug: 'test-class', level: 5, subclass: 'test-subclass', hpRolledPerLevel: [8, 5, 5, 5, 5] }]
    };
  }

  it('exposes one variant per equipped weapon', () => {
    const d = derive(characterWithGear(), lookup());
    const mw = d.availableActivations.find((a) => a.id === 'magic-weapon-active')!;
    expect(mw.variants).toEqual([
      { id: 'longsword', label: 'Longsword' },
      { id: 'dagger', label: 'Dagger' }
    ]);
  });

  it('skips non-weapon items from the variant list', () => {
    const SHIELD: ContentRow = {
      kind: 'item',
      slug: 'shield',
      version: 1,
      source: 'test',
      name: 'Shield',
      data: { category: 'armor', armorType: 'shield' }
    };
    const lookupWithShield: ContentLookup = (ref) => {
      if (ref.kind === 'item' && ref.slug === 'shield') return SHIELD;
      return lookup()(ref);
    };
    const char = characterWithGear(undefined, [{ slug: 'shield' }]);
    const d = derive(char, lookupWithShield);
    const mw = d.availableActivations.find((a) => a.id === 'magic-weapon-active')!;
    expect(mw.variants?.map((v) => v.id)).toEqual(['longsword', 'dagger']);
  });

  it('synthesizes a +1 attack action-modifier only for the picked weapon', () => {
    const d = derive(
      characterWithGear({ 'magic-weapon-active': { active: true, variant: 'longsword' } }),
      lookup()
    );
    const longswordAttack = d.actions.find(
      (a) => a.sourceContent.slug === 'longsword' && a.type === 'attack'
    );
    const daggerAttack = d.actions.find(
      (a) => a.sourceContent.slug === 'dagger' && a.type === 'attack'
    );
    expect(longswordAttack).toBeDefined();
    expect(daggerAttack).toBeDefined();
    // Longsword gets the +1 (its attackBonus includes the action-modifier's add).
    const lsModIds = longswordAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(lsModIds).toContain('magic-weapon-attack-bonus');
    // Dagger does not.
    const dgModIds = daggerAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(dgModIds).not.toContain('magic-weapon-attack-bonus');
  });

  it('synthesizes nothing when the picked variant is no longer equipped', () => {
    // Character had picked "longsword" but only the dagger is equipped now.
    const char: CharacterDocument = {
      ...characterWithGear({ 'magic-weapon-active': { active: true, variant: 'longsword' } }),
      inventory: [
        { contentKind: 'item', contentSlug: 'dagger', equipped: true, attuned: false }
      ]
    };
    const d = derive(char, lookup());
    const daggerAttack = d.actions.find(
      (a) => a.sourceContent.slug === 'dagger' && a.type === 'attack'
    );
    expect(daggerAttack).toBeDefined();
    // Neither weapon picks up the bonus — picked variant isn't in dynamicVariants.
    const dgModIds = daggerAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(dgModIds).not.toContain('magic-weapon-attack-bonus');
  });

  it('synthesizes nothing when activation is inactive', () => {
    const d = derive(
      characterWithGear({ 'magic-weapon-active': { active: false, variant: 'longsword' } }),
      lookup()
    );
    const longswordAttack = d.actions.find(
      (a) => a.sourceContent.slug === 'longsword' && a.type === 'attack'
    );
    const lsModIds = longswordAttack!.appliedModifiers.map((m) => m.modifierId);
    expect(lsModIds).not.toContain('magic-weapon-attack-bonus');
  });
});

// Locks the scalingByCastSlot contract: a modifier template value of
// shape {scalingByCastSlot: {baseSlotLevel, table}} is resolved at
// synthesis time against the picked cast slot. Powers Magic Weapon
// +1 (slot 2) / +2 (slot 3-5) / +3 (slot 6+), Elemental Weapon
// 1d4 (slot 3) / 2d4 (slot 5-6) / 3d4 (slot 7+), etc.
describe('scalingByCastSlot — slot-aware modifier scaling', () => {
  // Spell-shaped feature: variantsFromWeapons with scaling on attack.value.
  const MAGIC_WEAPON_SCALING: ContentRow = {
    kind: 'feature',
    slug: 'magic-weapon-scaling-shape',
    version: 1,
    source: 'test',
    name: 'Magic Weapon Scaling Shape',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'test-subclass',
      minLevel: 1,
      activations: [
        {
          id: 'magic-weapon-scaling-active',
          name: 'Magic Weapon',
          cost: 'bonus',
          duration: { value: 1, units: 'hour' },
          condition: 'magic-weapon-scaling-active',
          variantsFromWeapons: {
            modifiers: [
              {
                kind: 'action-modifier',
                id: 'magic-weapon-scaling-attack',
                appliesTo: {
                  activityType: 'attack',
                  predicates: [{ 'weapon.slug': '__weapon__' }]
                },
                effects: [
                  {
                    target: 'attack.roll',
                    mode: 'ADD',
                    value: { scalingByCastSlot: { baseSlotLevel: 2, table: [1, 2, 2, 2, 3, 3, 3, 3] } }
                  }
                ]
              }
            ]
          }
        }
      ]
    }
  };
  const TEST_CLASS_FOR_SCALING: ContentRow = {
    ...SYNTH_CLASS,
    data: { ...SYNTH_CLASS.data, features: ['magic-weapon-scaling-shape'] }
  };
  const LONGSWORD: ContentRow = {
    kind: 'item',
    slug: 'longsword',
    version: 1,
    source: 'test',
    name: 'Longsword',
    data: {
      category: 'weapon',
      weaponType: 'martial',
      activities: [
        {
          id: 'longsword-attack',
          type: 'attack',
          name: 'Longsword',
          cost: 'action',
          attack: {
            ability: 'str',
            classification: 'weapon',
            range: 'melee',
            damage: [{ dice: '1d8', type: 'slashing' }]
          }
        }
      ]
    }
  };
  function lookup(): ContentLookup {
    const map = new Map<string, ContentRow>([
      ['class/test-class', TEST_CLASS_FOR_SCALING],
      ['subclass/test-subclass', SYNTH_SUBCLASS],
      ['species/test-species', SYNTH_SPECIES],
      ['feature/magic-weapon-scaling-shape', MAGIC_WEAPON_SCALING],
      ['item/longsword', LONGSWORD]
    ]);
    return (ref) => map.get(`${ref.kind}/${ref.slug}`);
  }
  function character(
    activations?: Record<string, { active: boolean; variant?: string; slot?: number }>
  ): CharacterDocument {
    return {
      ...baseCharacter(activations),
      inventory: [
        { contentKind: 'item', contentSlug: 'longsword', equipped: true, attuned: false }
      ]
    };
  }

  it('manifest exposes slotScaling.baseSlotLevel when scaling is present in the template', () => {
    const d = derive(character(), lookup());
    const mw = d.availableActivations.find((a) => a.id === 'magic-weapon-scaling-active')!;
    expect(mw.slotScaling).toEqual({ baseSlotLevel: 2 });
    // activeSlot defaults to baseSlotLevel when state.slot isn't set.
    expect(mw.activeSlot).toBe(2);
  });

  it('synthesizes +1 attack when activated at base slot (2)', () => {
    const d = derive(
      character({ 'magic-weapon-scaling-active': { active: true, variant: 'longsword', slot: 2 } }),
      lookup()
    );
    const attack = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.type === 'attack')!;
    // Base STR mod 0 + L5 proficiency 3 → 3. With +1 from scaling → 4.
    expect(attack.attackBonus).toBe(4);
  });

  it('synthesizes +2 attack when activated at slot 3', () => {
    const d = derive(
      character({ 'magic-weapon-scaling-active': { active: true, variant: 'longsword', slot: 3 } }),
      lookup()
    );
    const attack = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.type === 'attack')!;
    expect(attack.attackBonus).toBe(5);
  });

  it('synthesizes +3 attack when activated at slot 6', () => {
    const d = derive(
      character({ 'magic-weapon-scaling-active': { active: true, variant: 'longsword', slot: 6 } }),
      lookup()
    );
    const attack = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.type === 'attack')!;
    expect(attack.attackBonus).toBe(6);
  });

  it('clamps to the last table entry when slot exceeds table length', () => {
    const d = derive(
      character({ 'magic-weapon-scaling-active': { active: true, variant: 'longsword', slot: 9 } }),
      lookup()
    );
    const attack = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.type === 'attack')!;
    expect(attack.attackBonus).toBe(6); // table caps at 3; +3 over base 3
  });

  it('defaults to baseSlotLevel when state.slot is not set', () => {
    const d = derive(
      character({ 'magic-weapon-scaling-active': { active: true, variant: 'longsword' } }),
      lookup()
    );
    const attack = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.type === 'attack')!;
    expect(attack.attackBonus).toBe(4); // slot defaults to 2 → +1
  });
});
