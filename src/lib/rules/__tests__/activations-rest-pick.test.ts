// Per-rest variant pick (Fiendish Resilience-shape). An activation
// with `restPickRequired` becomes "active" whenever a variant is
// recorded; the picked variant's modifiers + condition slug flow
// through the standard activation synthesis pipeline; the recorded
// variant is wiped on a matching rest. Locks the engine + helper
// contract:
//
//   - derive() emits restPickRequired/restPickLabel on the manifest.
//   - derive() treats `state.variant != null` as "active" for these.
//   - pickRestVariant() records / clears the slot.
//   - refreshActivations() wipes the variant on the matching rest
//     and on a long rest when the pick was short-rest-bound.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { pickRestVariant, refreshActivations } from '../activations';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const SYNTH_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-class',
  version: 1,
  source: 'test',
  name: 'Test Class',
  data: { hitDie: 8, primaryAbility: 'cha', savingThrows: ['wis', 'cha'] }
};

const SYNTH_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'fiend-like',
  version: 1,
  source: 'test',
  name: 'Fiend-Like',
  data: {
    parentClass: 'test-class',
    subclassFeatures: [{ level: 1, name: 'Fiendish Resilience-Like' }]
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

// Fiendish Resilience-shape: "choose one damage type at rest;
// resistance to that type until you choose a different one."
// Encoded as an activation with restPickRequired='short-rest' and
// per-variant resistance.<type> modifiers.
const FIENDISH_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'fiendish-resilience-like',
  version: 1,
  source: 'test',
  name: 'Fiendish Resilience-Like',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'fiend-like',
    minLevel: 1,
    activations: [
      {
        id: 'fiendish-resilience',
        name: 'Fiendish Resilience',
        condition: 'fiendish-resilience-active',
        restPickRequired: 'short-rest',
        restPickLabel: 'Damage type',
        variants: [
          {
            id: 'fire',
            label: 'Fire',
            modifiers: [
              { kind: 'stat-modifier', target: 'resistance.fire', mode: 'OVERRIDE', value: true }
            ]
          },
          {
            id: 'cold',
            label: 'Cold',
            modifiers: [
              { kind: 'stat-modifier', target: 'resistance.cold', mode: 'OVERRIDE', value: true }
            ]
          },
          {
            id: 'lightning',
            label: 'Lightning',
            modifiers: [
              {
                kind: 'stat-modifier',
                target: 'resistance.lightning',
                mode: 'OVERRIDE',
                value: true
              }
            ]
          }
        ]
      }
    ]
  }
};

function makeLookup(): ContentLookup {
  const rows: ContentRow[] = [SYNTH_CLASS, SYNTH_SUBCLASS, SYNTH_SPECIES, FIENDISH_FEATURE];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(
  activations?: Record<string, { active: boolean; usesRemaining?: number; variant?: string }>
): CharacterDocument {
  return {
    id: 'test-fiendish',
    name: 'Test',
    classes: [
      {
        slug: 'test-class',
        level: 10,
        subclass: 'fiend-like',
        hpRolledPerLevel: [8, 5, 5, 5, 5, 5, 5, 5, 5, 5]
      }
    ],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 18 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 60,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    activations
  };
}

describe('restPickRequired — manifest + active derivation', () => {
  it('exposes restPickRequired + restPickLabel on the manifest entry', () => {
    const d = derive(baseCharacter(), makeLookup());
    const fr = d.availableActivations.find((a) => a.id === 'fiendish-resilience');
    expect(fr).toBeDefined();
    expect(fr!.restPickRequired).toBe('short-rest');
    expect(fr!.restPickLabel).toBe('Damage type');
    expect(fr!.variants).toEqual([
      { id: 'fire', label: 'Fire' },
      { id: 'cold', label: 'Cold' },
      { id: 'lightning', label: 'Lightning' }
    ]);
  });

  it('starts active=false when no variant is recorded — even without a stored on/off flag', () => {
    const d = derive(baseCharacter(), makeLookup());
    const fr = d.availableActivations.find((a) => a.id === 'fiendish-resilience')!;
    expect(fr.active).toBe(false);
    expect(fr.activeVariant).toBeUndefined();
    expect(d.stats.resistances.has('fire')).toBe(false);
    expect(d.stats.resistances.has('cold')).toBe(false);
  });

  it('derives active=true purely from variant presence (no separate active flag needed)', () => {
    // Pack rows / panel writes only state.variant (active stays false on
    // the stored record) — the manifest entry should still flip to active.
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: false, variant: 'fire' } }),
      makeLookup()
    );
    const fr = d.availableActivations.find((a) => a.id === 'fiendish-resilience')!;
    expect(fr.active).toBe(true);
    expect(fr.activeVariant).toBe('fire');
  });
});

describe('restPickRequired — synthesized resistance + condition injection', () => {
  it('emits the picked damage type as a resistance', () => {
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      makeLookup()
    );
    expect(d.stats.resistances.has('fire')).toBe(true);
    expect(d.stats.resistances.has('cold')).toBe(false);
    expect(d.stats.resistances.has('lightning')).toBe(false);
  });

  it('swaps the resistance when the picked variant changes', () => {
    const fire = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      makeLookup()
    );
    const cold = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'cold' } }),
      makeLookup()
    );
    expect(fire.stats.resistances.has('fire')).toBe(true);
    expect(fire.stats.resistances.has('cold')).toBe(false);
    expect(cold.stats.resistances.has('cold')).toBe(true);
    expect(cold.stats.resistances.has('fire')).toBe(false);
  });

  it('emits no resistance when the variant is missing (post-rest state)', () => {
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: false } }),
      makeLookup()
    );
    expect(d.stats.resistances.has('fire')).toBe(false);
    expect(d.stats.resistances.has('cold')).toBe(false);
  });
});

describe('pickRestVariant — recording the slot', () => {
  it('records the picked variant and flips active=true on the stored state', () => {
    const d = derive(baseCharacter(), makeLookup());
    const updated = pickRestVariant(baseCharacter(), d.availableActivations, 'fiendish-resilience', 'fire');
    expect(updated.activations!['fiendish-resilience'].variant).toBe('fire');
    expect(updated.activations!['fiendish-resilience'].active).toBe(true);
  });

  it('clears the slot when variant=null (re-pick at next rest)', () => {
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      makeLookup()
    );
    const updated = pickRestVariant(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      d.availableActivations,
      'fiendish-resilience',
      null
    );
    expect(updated.activations!['fiendish-resilience'].variant).toBeUndefined();
    expect(updated.activations!['fiendish-resilience'].active).toBe(false);
  });

  it('rejects a variant that is not in the declared list (preserves prior state)', () => {
    const d = derive(baseCharacter(), makeLookup());
    const start = baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } });
    const updated = pickRestVariant(start, d.availableActivations, 'fiendish-resilience', 'radiant');
    expect(updated).toBe(start);
  });

  it('is a no-op when applied to a non-restPickRequired activation', () => {
    // Magic Weapon-style: variants but no restPickRequired. The helper
    // refuses to write a pick and returns the original character.
    const fakeMW = [
      {
        id: 'magic-weapon',
        name: 'Magic Weapon',
        sourceContent: { kind: 'spell', slug: 'magic-weapon' },
        usesMax: null,
        usesRemaining: null,
        refreshOn: null,
        condition: 'magic-weapon-active',
        active: false,
        variants: [{ id: 'longsword', label: 'Longsword' }]
      }
    ];
    const start = baseCharacter();
    const updated = pickRestVariant(start, fakeMW, 'magic-weapon', 'longsword');
    expect(updated).toBe(start);
  });
});

describe('refreshActivations — rest clears restPickRequired slot', () => {
  it('short rest clears a short-rest-bound pick', () => {
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      makeLookup()
    );
    const refreshed = refreshActivations(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } }),
      d.availableActivations,
      'short-rest'
    );
    expect(refreshed.activations!['fiendish-resilience'].variant).toBeUndefined();
    expect(refreshed.activations!['fiendish-resilience'].active).toBe(false);
  });

  it('long rest clears a short-rest-bound pick (long rest covers short rest)', () => {
    const d = derive(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'cold' } }),
      makeLookup()
    );
    const refreshed = refreshActivations(
      baseCharacter({ 'fiendish-resilience': { active: true, variant: 'cold' } }),
      d.availableActivations,
      'long-rest'
    );
    expect(refreshed.activations!['fiendish-resilience'].variant).toBeUndefined();
  });

  it('short rest leaves a long-rest-bound pick alone', () => {
    // Same shape but bound to long rest only.
    const LONG_REST_FEATURE: ContentRow = {
      ...FIENDISH_FEATURE,
      data: {
        ...FIENDISH_FEATURE.data,
        activations: [
          {
            ...(FIENDISH_FEATURE.data as { activations: Array<Record<string, unknown>> })
              .activations[0],
            restPickRequired: 'long-rest'
          }
        ]
      }
    };
    const lookup: ContentLookup = (ref) => {
      const map = new Map<string, ContentRow>([
        [`class/test-class`, SYNTH_CLASS],
        [`subclass/fiend-like`, SYNTH_SUBCLASS],
        [`species/test-species`, SYNTH_SPECIES],
        [`feature/fiendish-resilience-like`, LONG_REST_FEATURE]
      ]);
      return map.get(`${ref.kind}/${ref.slug}`);
    };
    const start = baseCharacter({ 'fiendish-resilience': { active: true, variant: 'fire' } });
    const d = derive(start, lookup);
    const refreshed = refreshActivations(start, d.availableActivations, 'short-rest');
    expect(refreshed.activations!['fiendish-resilience'].variant).toBe('fire');
    expect(refreshed.activations!['fiendish-resilience'].active).toBe(true);
  });

  it('returns the same character reference when nothing needs clearing', () => {
    const d = derive(baseCharacter(), makeLookup());
    // No variant recorded → nothing to clear.
    const start = baseCharacter();
    const refreshed = refreshActivations(start, d.availableActivations, 'long-rest');
    expect(refreshed).toBe(start);
  });
});
