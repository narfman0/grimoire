// Damage-source-predicate consumer. Pure function: given an incoming
// damage event (amount, damage type, source context) and the target's
// resistance/immunity/vulnerability maps from `Derived.stats`, returns
// the adjusted damage amount.
//
// This is the consumer wiring for the structured `*SourcePredicates`
// that derive() now populates. The encounter runtime calls this between
// "we know how much damage was rolled" and "apply it to HP via
// applyDamageDelta" so a Spell-Resistant character's fire resistance
// only fires against spell-source fire, not weapon-source fire.
//
// Resolution rules (per damage type, evaluated against the target's
// stats):
//   1. Immunity wins — if immune, return 0.
//      - Unqualified `immunities.has(type)` always immunes.
//      - A `immunitySourcePredicates[type]` only immunes when the
//        predicate matches the incoming context.
//      - If a flat-set entry exists without a predicate entry, that's
//        unconditional immunity (matches the engine's "unqualified
//        trumps qualified" rule).
//   2. Resistance halves (round down).
//   3. Vulnerability doubles.
//   4. Resistance + vulnerability cancel (5e rule: each applies once,
//      then they cancel; result = base amount).
//
// The legacy `*Qualifiers` maps (carrying `'nonmagical'`-style damage-
// side qualifiers) are also consulted: a `qualifier === 'nonmagical'`
// resistance/immunity only fires when the incoming context says the
// damage IS nonmagical. Source-side qualifiers (`'spell'`, `'magical'`,
// `'creatureType:<slug>'`) are already lifted into the structured
// `*SourcePredicates` map by derive(), so this consumer reads from
// there for the source-side narrowing.

import type { StatBlock } from './types';
import { matchesDamageSource, type DamageSourceContext } from './damage-source';

/** Target-side stat shape the helper needs. Sliced from `Derived.stats`
 *  so callers don't have to pass the whole StatBlock. */
export interface DamageResolutionStats {
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  resistanceQualifiers: Record<string, string>;
  immunityQualifiers: Record<string, string>;
  vulnerabilityQualifiers: Record<string, string>;
  resistanceSourcePredicates: StatBlock['resistanceSourcePredicates'];
  immunitySourcePredicates: StatBlock['immunitySourcePredicates'];
  vulnerabilitySourcePredicates: StatBlock['vulnerabilitySourcePredicates'];
}

/** Apply resistance / immunity / vulnerability to `amount` for an
 *  incoming damage event of `damageType`. Returns the adjusted amount
 *  (non-negative integer). Pure — caller forwards the result into
 *  `applyDamageDelta`.
 *
 *  When `damageType` is undefined the helper short-circuits (no
 *  type-keyed adjustment is possible) and returns the floored amount.
 *  Callers that don't yet plumb a damage type get the legacy
 *  unconditional behavior. */
export function computeIncomingDamage(
  amount: number,
  damageType: string | undefined,
  context: DamageSourceContext,
  stats: DamageResolutionStats
): number {
  const n = Math.max(0, Math.floor(amount));
  if (n === 0) return 0;
  if (!damageType) return n;

  // 1. Immunity check. Resolve by:
  //    - Unconditional immunity (`immunities.has` AND no predicate AND
  //      no qualifier) → immune.
  //    - Predicate-narrowed (`immunitySourcePredicates[type]`) → immune
  //      only when the predicate matches the context.
  //    - Qualifier-narrowed (`immunityQualifiers[type]`) → immune only
  //      when the qualifier matches the context (currently just
  //      'nonmagical').
  if (isImmune(damageType, context, stats)) return 0;

  // 2. Resistance / vulnerability. Half / double; cancel when both.
  const resistant = isResistant(damageType, context, stats);
  const vulnerable = isVulnerable(damageType, context, stats);
  if (resistant && vulnerable) return n; // 5e: cancel each other out.
  if (resistant) return Math.floor(n / 2);
  if (vulnerable) return n * 2;
  return n;
}

function isImmune(
  type: string,
  ctx: DamageSourceContext,
  s: DamageResolutionStats
): boolean {
  if (!s.immunities.has(type)) return false;
  const pred = s.immunitySourcePredicates[type];
  const qual = s.immunityQualifiers[type];
  // Unconditional immunity wins.
  if (!pred && !qual) return true;
  if (pred && !matchesDamageSource(pred, ctx)) {
    // Predicate exists and didn't match — only fall through to qualifier.
    return qual ? qualifierMatches(qual, ctx) : false;
  }
  if (pred && matchesDamageSource(pred, ctx)) return true;
  // No predicate (qualifier-only).
  return qual ? qualifierMatches(qual, ctx) : false;
}

function isResistant(
  type: string,
  ctx: DamageSourceContext,
  s: DamageResolutionStats
): boolean {
  if (!s.resistances.has(type)) return false;
  const pred = s.resistanceSourcePredicates[type];
  const qual = s.resistanceQualifiers[type];
  if (!pred && !qual) return true;
  if (pred && !matchesDamageSource(pred, ctx)) {
    return qual ? qualifierMatches(qual, ctx) : false;
  }
  if (pred && matchesDamageSource(pred, ctx)) return true;
  return qual ? qualifierMatches(qual, ctx) : false;
}

function isVulnerable(
  type: string,
  ctx: DamageSourceContext,
  s: DamageResolutionStats
): boolean {
  if (!s.vulnerabilities.has(type)) return false;
  const pred = s.vulnerabilitySourcePredicates[type];
  const qual = s.vulnerabilityQualifiers[type];
  if (!pred && !qual) return true;
  if (pred && !matchesDamageSource(pred, ctx)) {
    return qual ? qualifierMatches(qual, ctx) : false;
  }
  if (pred && matchesDamageSource(pred, ctx)) return true;
  return qual ? qualifierMatches(qual, ctx) : false;
}

/** Match a legacy qualifier string against the incoming damage context.
 *  Source-side qualifiers ('spell', 'magical', 'creatureType:*') are
 *  already lifted into the structured predicate map by derive(), so
 *  this only handles damage-kind qualifiers — currently just
 *  'nonmagical'. */
function qualifierMatches(qualifier: string, ctx: DamageSourceContext): boolean {
  if (qualifier === 'nonmagical') return ctx.damageSourceKind === 'nonmagical';
  // Source-side qualifiers are handled upstream by the structured
  // predicate; if a string slipped through, we conservatively don't
  // match it here so the predicate path stays canonical.
  return false;
}
