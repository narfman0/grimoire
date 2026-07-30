import { describe, it, expect } from 'vitest';
import {
  DAMAGE_TYPES,
  classifyDamageSourceKind,
  damageResolutionStatsFrom,
  narrowIncomingDamage,
  normalizeDamageType
} from '../damage-resolution';

describe('normalizeDamageType', () => {
  it('lowercases and trims', () => {
    expect(normalizeDamageType('  Fire ')).toBe('fire');
  });

  it("strips the content-pack's -damage suffix", () => {
    expect(normalizeDamageType('poison-damage')).toBe('poison');
  });

  it('leaves prose blobs alone so they simply never match', () => {
    const blob = 'bludgeoning, piercing, and slashing from nonmagical attacks';
    expect(normalizeDamageType(blob)).toBe(blob);
  });
});

describe('damageResolutionStatsFrom', () => {
  it('normalizes every bucket and leaves the narrowing maps empty', () => {
    const stats = damageResolutionStatsFrom({
      resistances: ['Cold'],
      immunities: ['poison-damage'],
      vulnerabilities: ['bludgeoning']
    });
    expect([...stats.resistances]).toEqual(['cold']);
    expect([...stats.immunities]).toEqual(['poison']);
    expect([...stats.vulnerabilities]).toEqual(['bludgeoning']);
    expect(stats.resistanceQualifiers).toEqual({});
    expect(stats.immunitySourcePredicates).toEqual({});
  });

  it('tolerates missing buckets', () => {
    const stats = damageResolutionStatsFrom({});
    expect(stats.resistances.size).toBe(0);
    expect(stats.immunities.size).toBe(0);
    expect(stats.vulnerabilities.size).toBe(0);
  });
});

describe('classifyDamageSourceKind', () => {
  it.each([
    ['spell:fireball', 'spell'],
    ['attack:longsword', 'nonmagical'],
    ['Bite', undefined],
    ['dm-adhoc', undefined]
  ] as const)('%s → %s', (id, expected) => {
    expect(classifyDamageSourceKind(id)).toBe(expected);
  });
});

describe('narrowIncomingDamage', () => {
  const stats = damageResolutionStatsFrom({
    resistances: ['fire'],
    immunities: ['poison'],
    vulnerabilities: ['bludgeoning']
  });

  it('halves a resisted type and labels the narrowing', () => {
    const n = narrowIncomingDamage(13, 'fire', {}, stats);
    expect(n.amount).toBe(6);
    expect(n.kind).toBe('resisted');
    expect(n.label).toBe('fire resisted (13 → 6)');
  });

  it('zeroes an immune type', () => {
    const n = narrowIncomingDamage(9, 'poison', {}, stats);
    expect(n.amount).toBe(0);
    expect(n.kind).toBe('immune');
    expect(n.label).toBe('immune to poison (9 → 0)');
  });

  it('doubles a vulnerable type', () => {
    const n = narrowIncomingDamage(6, 'bludgeoning', {}, stats);
    expect(n.amount).toBe(12);
    expect(n.kind).toBe('vulnerable');
    expect(n.label).toBe('bludgeoning vulnerable (6 → 12)');
  });

  it('reports nothing for an unaffected type', () => {
    expect(narrowIncomingDamage(7, 'slashing', {}, stats)).toEqual({
      amount: 7,
      kind: null,
      label: null
    });
  });

  it('normalizes the incoming type before matching', () => {
    expect(narrowIncomingDamage(10, 'Fire', {}, stats).amount).toBe(5);
  });

  it('passes through with no type or no stats — the pre-plumbing behavior', () => {
    expect(narrowIncomingDamage(10, null, {}, stats).amount).toBe(10);
    expect(narrowIncomingDamage(10, 'fire', {}, null).amount).toBe(10);
    expect(narrowIncomingDamage(10, 'fire', {}, null).kind).toBeNull();
  });

  it('floors and clamps the incoming amount', () => {
    expect(narrowIncomingDamage(-3, 'fire', {}, stats).amount).toBe(0);
    expect(narrowIncomingDamage(7.9, 'slashing', {}, stats).amount).toBe(7);
  });
});

describe('DAMAGE_TYPES', () => {
  it('covers the printed 5e list exactly once each', () => {
    expect(DAMAGE_TYPES).toHaveLength(13);
    expect(new Set(DAMAGE_TYPES).size).toBe(13);
    expect(DAMAGE_TYPES.every((t) => t === normalizeDamageType(t))).toBe(true);
  });
});
