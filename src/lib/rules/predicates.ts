// Predicate matcher for action-modifier `appliesTo.predicates`. A predicate
// is a flat object whose keys are dot-paths into an action context. Values
// are scalar, array (any-of), or `{ gte: N }` / `{ lte: N }` / `{ in: [...] }`.

export type PredicateContext = Record<string, unknown>;

export interface PredicateBlock {
  activityType?: string | string[];
  predicates?: Array<Record<string, unknown>>;
}

function getPath(ctx: PredicateContext, path: string): unknown {
  if (path.includes('.')) {
    return path.split('.').reduce<unknown>((acc, k) => {
      if (acc != null && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, ctx);
  }
  return ctx[path];
}

/** The operator keys `matchValue` understands inside an object-shaped
 *  expected value. Anything else (a `{gt: 5}` typo for `{gte: 5}`, say)
 *  silently never matches — `validatePredicateBlock` surfaces those so
 *  derive() can emit a soft validation warning. */
export const KNOWN_PREDICATE_OPERATORS = ['eq', 'neq', 'gte', 'lte', 'in'] as const;

const KNOWN_OPERATOR_SET: ReadonlySet<string> = new Set(KNOWN_PREDICATE_OPERATORS);

/** Soft-validate a predicate block (`appliesTo`-shaped: `{ activityType?,
 *  predicates? }`). Walks every expected value the same way `matchValue`
 *  will — array elements, `or` sub-predicates — and reports each operator
 *  key that `matchValue` would not recognize. Returns human-readable
 *  problem strings; empty array when clean. Accepts `unknown` because
 *  callers hand it raw pack data. */
export function validatePredicateBlock(block: unknown): string[] {
  const problems: string[] = [];
  if (block == null || typeof block !== 'object') return problems;
  const preds = (block as { predicates?: unknown }).predicates;
  if (!Array.isArray(preds)) return problems;

  const checkExpected = (path: string, expected: unknown): void => {
    if (Array.isArray(expected)) {
      for (const v of expected) checkExpected(path, v);
      return;
    }
    if (expected != null && typeof expected === 'object') {
      for (const op of Object.keys(expected)) {
        if (!KNOWN_OPERATOR_SET.has(op)) {
          problems.push(`predicate '${path}' uses unknown operator '${op}'`);
        }
      }
    }
  };

  for (const p of preds) {
    if (p == null || typeof p !== 'object') continue;
    for (const [key, expected] of Object.entries(p as Record<string, unknown>)) {
      if (key === 'or' && Array.isArray(expected)) {
        for (const sub of expected) {
          if (sub == null || typeof sub !== 'object') continue;
          for (const [k, v] of Object.entries(sub as Record<string, unknown>)) {
            checkExpected(k, v);
          }
        }
        continue;
      }
      checkExpected(key, expected);
    }
  }
  return problems;
}

function matchValue(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((v) => matchValue(value, v));
  }
  if (expected != null && typeof expected === 'object') {
    const exp = expected as Record<string, unknown>;
    if ('eq' in exp) return value === exp.eq;
    if ('neq' in exp) return value !== exp.neq;
    if ('gte' in exp || 'lte' in exp) {
      // Range check: both bounds evaluated together so { gte: 1, lte: 5 } works.
      if (typeof value !== 'number') return false;
      if ('gte' in exp && value < (exp.gte as number)) return false;
      if ('lte' in exp && value > (exp.lte as number)) return false;
      return true;
    }
    if ('in' in exp && Array.isArray(exp.in))
      return (exp.in as unknown[]).includes(value);
    return false;
  }
  // Array-on-context: predicate value is scalar; ctx value is an array.
  // Treat as "context array contains scalar".
  if (Array.isArray(value)) return value.includes(expected);
  return value === expected;
}

export function predicateMatches(ctx: PredicateContext, block: PredicateBlock | undefined): boolean {
  if (!block) return true;
  if (block.activityType != null) {
    const allowed = block.activityType;
    const fail = Array.isArray(allowed)
      ? !allowed.includes(ctx.activityType as string)
      : ctx.activityType !== allowed;
    if (fail) return false;
  }
  for (const p of block.predicates ?? []) {
    for (const [key, expected] of Object.entries(p)) {
      if (key === 'or' && Array.isArray(expected)) {
        // Logical OR: any sub-predicate object must fully match.
        const anyMatch = expected.some((sub) => {
          if (sub == null || typeof sub !== 'object') return false;
          for (const [k, v] of Object.entries(sub as Record<string, unknown>)) {
            if (!matchValue(getPath(ctx, k), v)) return false;
          }
          return true;
        });
        if (!anyMatch) return false;
        continue;
      }
      const actual = getPath(ctx, key);
      if (!matchValue(actual, expected)) return false;
    }
  }
  return true;
}
