import { describe, it, expect } from 'vitest';
import { KNOWN_PREDICATE_OPERATORS, predicateMatches, validatePredicateBlock } from '../predicates';

describe('predicateMatches', () => {
  // Empty / undefined block → vacuous match. The check `if (!block) return
  // true` is what lets unconditional modifiers ride through derive().
  it('returns true when block is undefined', () => {
    expect(predicateMatches({ foo: 1 }, undefined)).toBe(true);
  });

  it('returns true when block has no predicates and no activityType', () => {
    expect(predicateMatches({ foo: 1 }, {})).toBe(true);
  });

  it('gates on activityType when present', () => {
    expect(predicateMatches({ activityType: 'attack' }, { activityType: 'attack' })).toBe(true);
    expect(predicateMatches({ activityType: 'attack' }, { activityType: 'save' })).toBe(false);
  });

  it('matches scalar key-value predicates', () => {
    expect(
      predicateMatches({ weaponKind: 'martial' }, { predicates: [{ weaponKind: 'martial' }] })
    ).toBe(true);
    expect(
      predicateMatches({ weaponKind: 'simple' }, { predicates: [{ weaponKind: 'martial' }] })
    ).toBe(false);
  });

  // Array-as-expected → any-of. Used for "weaponKind ∈ ['martial', 'simple']".
  it('matches when expected is an array (any-of)', () => {
    expect(
      predicateMatches(
        { weaponKind: 'simple' },
        { predicates: [{ weaponKind: ['martial', 'simple'] }] }
      )
    ).toBe(true);
    expect(
      predicateMatches(
        { weaponKind: 'ranged' },
        { predicates: [{ weaponKind: ['martial', 'simple'] }] }
      )
    ).toBe(false);
  });

  // Object operators: eq / neq / gte / lte / in.
  it('handles gte / lte numeric comparisons', () => {
    expect(predicateMatches({ level: 5 }, { predicates: [{ level: { gte: 5 } }] })).toBe(true);
    expect(predicateMatches({ level: 4 }, { predicates: [{ level: { gte: 5 } }] })).toBe(false);
    expect(predicateMatches({ level: 5 }, { predicates: [{ level: { lte: 5 } }] })).toBe(true);
    expect(predicateMatches({ level: 6 }, { predicates: [{ level: { lte: 5 } }] })).toBe(false);
  });

  it('handles combined gte+lte range (both bounds checked)', () => {
    // { gte: 1, lte: 5 } must pass only when 1 ≤ value ≤ 5.
    expect(predicateMatches({ level: 3 }, { predicates: [{ level: { gte: 1, lte: 5 } }] })).toBe(true);
    expect(predicateMatches({ level: 1 }, { predicates: [{ level: { gte: 1, lte: 5 } }] })).toBe(true);
    expect(predicateMatches({ level: 5 }, { predicates: [{ level: { gte: 1, lte: 5 } }] })).toBe(true);
    expect(predicateMatches({ level: 6 }, { predicates: [{ level: { gte: 1, lte: 5 } }] })).toBe(false);
    expect(predicateMatches({ level: 0 }, { predicates: [{ level: { gte: 1, lte: 5 } }] })).toBe(false);
  });

  it('handles array activityType in block (any-of)', () => {
    expect(predicateMatches({ activityType: 'cast' }, { activityType: ['cast', 'save', 'attack'] })).toBe(true);
    expect(predicateMatches({ activityType: 'save' }, { activityType: ['cast', 'save', 'attack'] })).toBe(true);
    expect(predicateMatches({ activityType: 'heal' }, { activityType: ['cast', 'save', 'attack'] })).toBe(false);
  });

  it('handles eq / neq', () => {
    expect(predicateMatches({ a: 1 }, { predicates: [{ a: { eq: 1 } }] })).toBe(true);
    expect(predicateMatches({ a: 1 }, { predicates: [{ a: { neq: 2 } }] })).toBe(true);
    expect(predicateMatches({ a: 1 }, { predicates: [{ a: { neq: 1 } }] })).toBe(false);
  });

  it('handles in: [...] membership', () => {
    expect(predicateMatches({ a: 'b' }, { predicates: [{ a: { in: ['a', 'b'] } }] })).toBe(true);
    expect(predicateMatches({ a: 'c' }, { predicates: [{ a: { in: ['a', 'b'] } }] })).toBe(false);
  });

  // Locks the dotted-path read used by every "context.foo.bar"-style
  // predicate. Regression here breaks predicates silently in derive().
  it('walks dot-separated paths into nested context', () => {
    expect(
      predicateMatches(
        { weapon: { kind: 'martial' } },
        { predicates: [{ 'weapon.kind': 'martial' }] }
      )
    ).toBe(true);
  });

  // Array on the context side, scalar expected = "context array contains
  // scalar". Used for things like `tags: ['ranged']` predicates against
  // `weapon.tags`.
  it('treats scalar-vs-array-context as "context array contains scalar"', () => {
    expect(
      predicateMatches(
        { tags: ['ranged', 'thrown'] },
        { predicates: [{ tags: 'thrown' }] }
      )
    ).toBe(true);
    expect(
      predicateMatches({ tags: ['ranged'] }, { predicates: [{ tags: 'finesse' }] })
    ).toBe(false);
  });

  // ALL predicates in a block must match (AND semantics within a block).
  it('requires every predicate in the list to match', () => {
    expect(
      predicateMatches(
        { weaponKind: 'martial', level: 5 },
        { predicates: [{ weaponKind: 'martial', level: { gte: 5 } }] }
      )
    ).toBe(true);
    expect(
      predicateMatches(
        { weaponKind: 'simple', level: 5 },
        { predicates: [{ weaponKind: 'martial', level: { gte: 5 } }] }
      )
    ).toBe(false);
  });

  // Logical OR: { "or": [{subPred1}, {subPred2}] } passes if any sub-predicate fully matches.
  // Used by sneak-attack (weapon.property:finesse OR attack.range:ranged).
  it('supports or-predicate: passes when any sub-predicate matches', () => {
    const ctx = { weapon: { property: ['finesse'] }, attack: { range: 'melee' } };
    expect(
      predicateMatches(ctx, { predicates: [{ or: [{ 'weapon.property': 'finesse' }, { 'attack.range': 'ranged' }] }] })
    ).toBe(true);
  });

  it('supports or-predicate: fails when no sub-predicate matches', () => {
    const ctx = { weapon: { property: ['thrown'] }, attack: { range: 'melee' } };
    expect(
      predicateMatches(ctx, { predicates: [{ or: [{ 'weapon.property': 'finesse' }, { 'attack.range': 'ranged' }] }] })
    ).toBe(false);
  });

  it('combines or-predicate with other predicates (AND semantics across predicates)', () => {
    const ctx = { weapon: { property: ['finesse'] }, attack: { range: 'melee', ability: 'dex' } };
    expect(
      predicateMatches(ctx, {
        predicates: [
          { or: [{ 'weapon.property': 'finesse' }, { 'attack.range': 'ranged' }] },
          { 'attack.ability': 'dex' }
        ]
      })
    ).toBe(true);
    expect(
      predicateMatches(ctx, {
        predicates: [
          { or: [{ 'weapon.property': 'finesse' }, { 'attack.range': 'ranged' }] },
          { 'attack.ability': 'str' }
        ]
      })
    ).toBe(false);
  });
});

// validatePredicateBlock — soft-validation companion to matchValue. Every
// operator object matchValue silently rejects must be reported here so
// derive() can warn instead of the modifier vanishing.
describe('validatePredicateBlock', () => {
  it('returns [] for undefined / non-object / predicate-less blocks', () => {
    expect(validatePredicateBlock(undefined)).toEqual([]);
    expect(validatePredicateBlock(null)).toEqual([]);
    expect(validatePredicateBlock('nope')).toEqual([]);
    expect(validatePredicateBlock({})).toEqual([]);
    expect(validatePredicateBlock({ activityType: 'attack' })).toEqual([]);
  });

  it('accepts every known operator without complaint', () => {
    const block = {
      predicates: [
        { a: { eq: 1 } },
        { b: { neq: 2 } },
        { c: { gte: 1, lte: 5 } },
        { d: { in: ['x', 'y'] } },
        { e: 'scalar' },
        { f: ['any', 'of'] }
      ]
    };
    expect(validatePredicateBlock(block)).toEqual([]);
    // Sanity: the exported list matches what the block above exercises.
    expect([...KNOWN_PREDICATE_OPERATORS].sort()).toEqual(['eq', 'gte', 'in', 'lte', 'neq']);
  });

  it('reports an unknown operator with its predicate path', () => {
    const problems = validatePredicateBlock({ predicates: [{ level: { gt: 5 } }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'level'");
    expect(problems[0]).toContain("'gt'");
  });

  it('reports unknown operators mixed into an otherwise-known object', () => {
    const problems = validatePredicateBlock({ predicates: [{ level: { gte: 1, gt: 5 } }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'gt'");
  });

  it('walks or-branches and array-of-expected values', () => {
    const problems = validatePredicateBlock({
      predicates: [
        { or: [{ 'weapon.property': 'finesse' }, { level: { gt: 3 } }] },
        { count: [{ gte: 1 }, { lt: 9 }] }
      ]
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("'gt'");
    expect(problems[1]).toContain("'lt'");
  });
});
