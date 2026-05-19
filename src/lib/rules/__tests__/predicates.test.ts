import { describe, it, expect } from 'vitest';
import { predicateMatches } from '../predicates';

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
});
