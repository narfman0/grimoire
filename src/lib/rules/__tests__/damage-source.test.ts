// Unit tests for the pure damage-source predicate matcher. Verifies the
// matching rules each predicate kind expresses, the round-trip between
// the legacy `qualifier` string form and the structured predicate, and
// the conservative fail-closed behavior for unknown / missing input.

import { describe, expect, it } from 'vitest';
import {
  matchesDamageSource,
  predicateFromQualifierString,
  predicateToQualifierString,
  type DamageSourceContext,
  type DamageSourcePredicate
} from '../damage-source';

describe('matchesDamageSource', () => {
  it('undefined predicate matches every event (the no-narrowing default)', () => {
    expect(matchesDamageSource(undefined, {})).toBe(true);
    expect(matchesDamageSource(undefined, { damageSourceKind: 'nonmagical' })).toBe(true);
    expect(matchesDamageSource(undefined, { damageSourceKind: 'spell' })).toBe(true);
  });

  it('kind=spell matches only spell-source events', () => {
    const p: DamageSourcePredicate = { kind: 'spell' };
    expect(matchesDamageSource(p, { damageSourceKind: 'spell' })).toBe(true);
    expect(matchesDamageSource(p, { damageSourceKind: 'magical' })).toBe(false);
    expect(matchesDamageSource(p, { damageSourceKind: 'nonmagical' })).toBe(false);
    expect(matchesDamageSource(p, {})).toBe(false);
  });

  it('kind=magical matches spell AND magical events (broader than spell)', () => {
    const p: DamageSourcePredicate = { kind: 'magical' };
    expect(matchesDamageSource(p, { damageSourceKind: 'spell' })).toBe(true);
    expect(matchesDamageSource(p, { damageSourceKind: 'magical' })).toBe(true);
    expect(matchesDamageSource(p, { damageSourceKind: 'nonmagical' })).toBe(false);
    expect(matchesDamageSource(p, {})).toBe(false);
  });

  it('kind=creatureType matches only the named creature type', () => {
    const fey: DamageSourcePredicate = { kind: 'creatureType', value: 'fey' };
    expect(matchesDamageSource(fey, { sourceCreatureType: 'fey' })).toBe(true);
    expect(matchesDamageSource(fey, { sourceCreatureType: 'fiend' })).toBe(false);
    expect(matchesDamageSource(fey, {})).toBe(false);
  });

  it('kind=creatureType with empty value fails closed', () => {
    // Authoring bug — should never match anything so the qualifier
    // doesn't silently grant resistance against every event.
    const bad: DamageSourcePredicate = { kind: 'creatureType', value: '' };
    expect(matchesDamageSource(bad, { sourceCreatureType: 'fey' })).toBe(false);
    expect(matchesDamageSource(bad, {})).toBe(false);
  });

  it('event without sourceCreatureType fails kind=creatureType', () => {
    const p: DamageSourcePredicate = { kind: 'creatureType', value: 'elemental' };
    expect(matchesDamageSource(p, { damageSourceKind: 'spell' })).toBe(false);
  });

  it('compound event matches if either field satisfies a single-axis predicate', () => {
    // The matcher is single-axis per predicate. A spell-source predicate
    // succeeds even when the source is also a known creature type.
    const event: DamageSourceContext = {
      damageSourceKind: 'spell',
      sourceCreatureType: 'fey'
    };
    expect(matchesDamageSource({ kind: 'spell' }, event)).toBe(true);
    expect(matchesDamageSource({ kind: 'creatureType', value: 'fey' }, event)).toBe(true);
    expect(matchesDamageSource({ kind: 'creatureType', value: 'fiend' }, event)).toBe(false);
  });

  it('unknown predicate kind fails closed (forward-compat safety)', () => {
    // Cast through unknown so an untyped pack row with a typo'd kind
    // doesn't silently match everything.
    const bogus = { kind: 'mystery-source' } as unknown as DamageSourcePredicate;
    expect(matchesDamageSource(bogus, { damageSourceKind: 'spell' })).toBe(false);
    expect(matchesDamageSource(bogus, {})).toBe(false);
  });
});

describe('predicate ↔ qualifier-string round trip', () => {
  it('spell predicate serializes to "spell"', () => {
    expect(predicateToQualifierString({ kind: 'spell' })).toBe('spell');
    expect(predicateFromQualifierString('spell')).toEqual({ kind: 'spell' });
  });

  it('magical predicate serializes to "magical"', () => {
    expect(predicateToQualifierString({ kind: 'magical' })).toBe('magical');
    expect(predicateFromQualifierString('magical')).toEqual({ kind: 'magical' });
  });

  it('creatureType predicate serializes to "creatureType:<value>"', () => {
    expect(
      predicateToQualifierString({ kind: 'creatureType', value: 'fey' })
    ).toBe('creatureType:fey');
    expect(predicateFromQualifierString('creatureType:fey')).toEqual({
      kind: 'creatureType',
      value: 'fey'
    });
  });

  it('lift returns undefined for damage-side qualifiers like "nonmagical"', () => {
    // "nonmagical" narrows the damage kind, not the source-of-damage. It
    // has no source-predicate interpretation and stays on the legacy
    // qualifier-string map only.
    expect(predicateFromQualifierString('nonmagical')).toBeUndefined();
  });

  it('lift returns undefined for unknown qualifier strings', () => {
    expect(predicateFromQualifierString('not-a-thing')).toBeUndefined();
    expect(predicateFromQualifierString('')).toBeUndefined();
  });
});
