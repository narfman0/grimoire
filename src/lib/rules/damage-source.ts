// Damage-source predicate matcher. Pure function shared by the rules engine
// (which carries the predicate on resolved qualifier entries) and the
// encounter runtime (which evaluates it against incoming damage events at
// damage-application time).
//
// The predicate sits on a resistance/immunity/vulnerability or
// save-advantage modifier and narrows when that modifier applies. It can
// express "only from spells", "only from magical attacks", or "only when
// the source is a creature of a given type" — the source predicates that
// the source-agnostic `qualifier` string can't carry (and that pack rows
// like phb-2024/features/spell-resistance.json and Circle of the Land
// elemental/fey-only immunity need).
//
// See docs/engine-gaps.md "Damage-source predicates" for the encounter-
// runtime wiring follow-on.

/** Predicate narrowing a stat-modifier's applicability by the *source* of
 *  incoming damage or the save being made. */
export type DamageSourcePredicate =
  /** Source is a spell cast. Matches when the incoming damage event's
   *  `damageSourceKind === 'spell'`, or when the save being made is
   *  against a spell. */
  | { kind: 'spell' }
  /** Source is magical in nature — broader than spell. Includes spells
   *  AND magic-weapon attacks AND magical-feature effects. The runtime
   *  treats `damageSourceKind === 'spell'` and `damageSourceKind ===
   *  'magical'` as matches. */
  | { kind: 'magical' }
  /** Source is a creature whose type matches `value` (fey, fiend,
   *  dragon, …). Used for Circle of the Land's "advantage on charmed/
   *  frightened saves against fey/elementals" pattern. */
  | { kind: 'creatureType'; value: string };

/** Shape of an incoming damage / save event that the predicate is
 *  evaluated against. All fields are optional; absence means "the runtime
 *  doesn't know" — predicates that require a field then fail-closed.
 *
 *  Consumers (encounter runtime) populate as much as they know about
 *  the incoming event. Unit tests construct the shape directly. */
export interface DamageSourceContext {
  /** Categorical source-kind tag. The runtime sets this based on the
   *  action that produced the damage / triggered the save:
   *  - 'spell' — damage from a spell cast or save vs a spell
   *  - 'magical' — magic-weapon attack, magical-effect damage that
   *    isn't a spell
   *  - 'nonmagical' — mundane weapon attack, fall damage, etc.
   *  Absent / undefined → not known. */
  damageSourceKind?: 'spell' | 'magical' | 'nonmagical';
  /** Creature type slug of the attacker / save-causer (`fey`,
   *  `fiend`, `dragon`, `elemental`, …). Lowercase, hyphenated. */
  sourceCreatureType?: string;
}

/** Pure matcher. Returns true iff the predicate matches the event.
 *  Undefined predicate is treated as "matches everything" (the
 *  no-source-narrowing default — preserves the existing unconditional
 *  resistance behavior). */
export function matchesDamageSource(
  predicate: DamageSourcePredicate | undefined,
  event: DamageSourceContext
): boolean {
  if (!predicate) return true;
  switch (predicate.kind) {
    case 'spell':
      return event.damageSourceKind === 'spell';
    case 'magical':
      // Spells are magical too — the broader predicate accepts both.
      return event.damageSourceKind === 'spell' || event.damageSourceKind === 'magical';
    case 'creatureType':
      if (!predicate.value) return false;
      return event.sourceCreatureType === predicate.value;
    default:
      // Unknown predicate kind — fail closed so a typo or future shape
      // doesn't silently grant resistance. The engine still surfaces the
      // qualifier in the structured map so a UI can flag the unknown shape.
      return false;
  }
}

/** Serialize a predicate to the legacy `qualifier` string form so the
 *  existing `resistanceQualifiers: Record<string, string>` map can carry
 *  a stable string representation alongside the structured form. The
 *  inverse is in `predicateFromQualifierString`. */
export function predicateToQualifierString(predicate: DamageSourcePredicate): string {
  switch (predicate.kind) {
    case 'spell':
      return 'spell';
    case 'magical':
      return 'magical';
    case 'creatureType':
      return `creatureType:${predicate.value}`;
    default:
      return 'unknown';
  }
}

/** Best-effort inverse: lift a legacy qualifier string (`'spell'`,
 *  `'magical'`, `'creatureType:fey'`, or a bare creature-type slug like
 *  `'fey'`) into a structured predicate. Returns undefined for
 *  qualifiers that don't have a source-predicate interpretation
 *  (notably `'nonmagical'`, which is a *damage*-side qualifier, not a
 *  source-side one — handled by the existing qualifier map). */
export function predicateFromQualifierString(qualifier: string): DamageSourcePredicate | undefined {
  if (qualifier === 'spell') return { kind: 'spell' };
  if (qualifier === 'magical') return { kind: 'magical' };
  if (qualifier.startsWith('creatureType:')) {
    return { kind: 'creatureType', value: qualifier.slice('creatureType:'.length) };
  }
  return undefined;
}
