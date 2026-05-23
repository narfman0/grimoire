// Engine integration tests for the damage-source predicate end-to-end:
// a homebrew feature row that emits a resistance / immunity / save-
// advantage stat-modifier with a `sourcePredicate` field flows through
// derive() onto the corresponding structured maps on Derived.stats.
//
// Also locks the back-compat path: a legacy `qualifier: 'spell'` string
// (no structured sourcePredicate) is lifted into the same structured
// map so existing pack rows pick up the new behavior automatically.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

/** Minimal character with one named feat. Tests fill in the feat row
 *  via the lookup. Keeps the fixture small so the test asserts only the
 *  qualifier flow, not unrelated stat composition. */
function charWithFeat(featSlug: string): CharacterDocument {
  return {
    id: 'srcpred-test',
    name: 'Source Predicate Subject',
    classes: [{ slug: 'wizard', level: 1, hpRolledPerLevel: [6] }],
    species: { kind: 'species', slug: 'gnome' },
    feats: [{ kind: 'feat', slug: featSlug }],
    abilityScores: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 6,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function lookupOnly(row: ContentRow) {
  return (ref: { kind: string; slug: string }) =>
    ref.kind === row.kind && ref.slug === row.slug ? row : undefined;
}

describe('derive() — sourcePredicate on resistance modifiers', () => {
  it('lands a kind=spell predicate on resistanceSourcePredicates', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'spell-resistance-test',
      version: 1,
      name: 'Spell Resistance',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'resistance.fire',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'spell' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    // Flat set still carries the type (UI iteration).
    expect(d.stats.resistances.has('fire')).toBe(true);
    // Structured predicate map carries the source-side narrowing.
    expect(d.stats.resistanceSourcePredicates.fire).toEqual({ kind: 'spell' });
    // Legacy qualifier-string map left empty (modifier did not author a
    // `qualifier` field).
    expect(d.stats.resistanceQualifiers.fire).toBeUndefined();
  });

  it('lifts a legacy qualifier="spell" string into resistanceSourcePredicates', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'legacy-spell-qual',
      version: 1,
      name: 'Legacy Qualifier',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'immunity.poison',
            mode: 'OVERRIDE',
            value: true,
            qualifier: 'spell'
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    expect(d.stats.immunities.has('poison')).toBe(true);
    expect(d.stats.immunityQualifiers.poison).toBe('spell');
    // Back-compat lift: structured predicate populated from the
    // string so the encounter runtime can consume one shape.
    expect(d.stats.immunitySourcePredicates.poison).toEqual({ kind: 'spell' });
  });

  it('leaves "nonmagical" qualifier off the predicate map (damage-side, not source-side)', () => {
    // Avatar of Battle prose: resistance to nonmagical b/p/s. The
    // 'nonmagical' qualifier narrows what *kind* of damage hits, not
    // who's dealing it — it doesn't have a source-predicate
    // interpretation, so the structured map stays empty for it.
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'nonmagical-resist',
      version: 1,
      name: 'Tough Hide',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'resistance.bludgeoning',
            mode: 'OVERRIDE',
            value: true,
            qualifier: 'nonmagical'
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    expect(d.stats.resistanceQualifiers.bludgeoning).toBe('nonmagical');
    expect(d.stats.resistanceSourcePredicates.bludgeoning).toBeUndefined();
  });

  it('kind=creatureType lands with its value on the structured map', () => {
    // Pattern: "resistance to damage from fey".
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'fey-warded',
      version: 1,
      name: 'Fey-Warded',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'vulnerability.psychic',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'creatureType', value: 'fey' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    expect(d.stats.vulnerabilities.has('psychic')).toBe(true);
    expect(d.stats.vulnerabilitySourcePredicates.psychic).toEqual({
      kind: 'creatureType',
      value: 'fey'
    });
  });

  it('unconditional resistance trumps a later source-narrowed one', () => {
    // Order-independent (allMods iteration runs over all sources). A bare
    // resistance.fire (no qualifier, no sourcePredicate) plus a fire
    // resistance narrowed to spells should yield an unqualified entry —
    // no structured predicate on the map.
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'fire-immunity-mixed',
      version: 1,
      name: 'Mixed Fire',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'resistance.fire',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'spell' }
          },
          {
            kind: 'stat-modifier',
            target: 'resistance.fire',
            mode: 'OVERRIDE',
            value: true
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    expect(d.stats.resistances.has('fire')).toBe(true);
    expect(d.stats.resistanceSourcePredicates.fire).toBeUndefined();
    expect(d.stats.resistanceQualifiers.fire).toBeUndefined();
  });

  it('malformed sourcePredicate is dropped (resistance becomes unconditional)', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'bad-pred',
      version: 1,
      name: 'Bad Predicate',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'resistance.cold',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'creatureType' /* missing value */ }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    // The malformed predicate is dropped at coercion; the modifier
    // still grants resistance (without source narrowing).
    expect(d.stats.resistances.has('cold')).toBe(true);
    expect(d.stats.resistanceSourcePredicates.cold).toBeUndefined();
  });
});

describe('derive() — sourcePredicate on save.advantage modifiers', () => {
  it('save.advantage.all with sourcePredicate lands on savesAdvantageSourceQualified', () => {
    // Gnome Cunning pattern: "advantage on INT/WIS/CHA saves against
    // magic" — modeled here with save.advantage.all + kind=magical to
    // demonstrate the qualified channel.
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'gnome-cunning-test',
      version: 1,
      name: 'Gnome Cunning',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'save.advantage.all',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'magical' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    // None of the unconditional save advantages — the qualified
    // channel intercepts it.
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(d.stats.saves[ab].advantage).toBe(false);
    }
    expect(d.stats.savesAdvantageSourceQualified.length).toBe(1);
    expect(d.stats.savesAdvantageSourceQualified[0]).toMatchObject({
      ability: 'all',
      sourcePredicate: { kind: 'magical' }
    });
  });

  it('save.advantage.vs-condition.X with sourcePredicate uses vsCondition slot', () => {
    // Circle of the Land pattern: "advantage on saves against the
    // charmed or frightened condition when caused by fey."
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'land-stride-test',
      version: 1,
      name: "Land's Stride",
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'save.advantage.vs-condition.charmed',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'creatureType', value: 'fey' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    // The unconditional vs-condition set should stay empty — the
    // qualified version captured the entry.
    expect(d.stats.savesAdvantageVs).toEqual([]);
    expect(d.stats.savesAdvantageSourceQualified.length).toBe(1);
    expect(d.stats.savesAdvantageSourceQualified[0]).toMatchObject({
      vsCondition: 'charmed',
      sourcePredicate: { kind: 'creatureType', value: 'fey' }
    });
    expect(d.stats.savesAdvantageSourceQualified[0].sourceContent).toEqual({
      kind: 'feat',
      slug: 'land-stride-test'
    });
  });

  it('save.advantage.<ability> with sourcePredicate uses ability slot', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'iron-mind',
      version: 1,
      name: 'Iron Mind',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'save.advantage.wis',
            mode: 'OVERRIDE',
            value: true,
            sourcePredicate: { kind: 'spell' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    expect(d.stats.saves.wis.advantage).toBe(false);
    expect(d.stats.savesAdvantageSourceQualified.length).toBe(1);
    expect(d.stats.savesAdvantageSourceQualified[0]).toMatchObject({
      ability: 'wis',
      sourcePredicate: { kind: 'spell' }
    });
  });

  it('save.advantage.all WITHOUT sourcePredicate still feeds the unconditional set', () => {
    // Back-compat: existing rows that don't author a sourcePredicate
    // continue to flow through the unconditional channel.
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'lucky',
      version: 1,
      name: 'Lucky',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'save.advantage.all',
            mode: 'OVERRIDE',
            value: true
          }
        ]
      }
    };
    const d = derive(charWithFeat(feat.slug), lookupOnly(feat));
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(d.stats.saves[ab].advantage).toBe(true);
    }
    expect(d.stats.savesAdvantageSourceQualified).toEqual([]);
  });
});
