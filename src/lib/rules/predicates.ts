// Predicate matcher for action-modifier `appliesTo.predicates`. A predicate
// is a flat object whose keys are dot-paths into an action context. Values
// are scalar, array (any-of), or `{ gte: N }` / `{ lte: N }` / `{ in: [...] }`.

export type PredicateContext = Record<string, unknown>;

export interface PredicateBlock {
  activityType?: string;
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

function matchValue(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((v) => matchValue(value, v));
  }
  if (expected != null && typeof expected === 'object') {
    const exp = expected as Record<string, unknown>;
    if ('eq' in exp) return value === exp.eq;
    if ('neq' in exp) return value !== exp.neq;
    if ('gte' in exp) return typeof value === 'number' && value >= (exp.gte as number);
    if ('lte' in exp) return typeof value === 'number' && value <= (exp.lte as number);
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
  if (block.activityType != null && ctx.activityType !== block.activityType) return false;
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
