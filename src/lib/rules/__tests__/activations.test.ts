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
});
